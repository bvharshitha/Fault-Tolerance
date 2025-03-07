#!/usr/bin/env python3
import grpc
from concurrent import futures
import time
import threading
import sys
import random

import swim_pb2
import swim_pb2_grpc

T_PING = 5  # Ping interval (seconds)

class FailureDetectorServicer(swim_pb2_grpc.FailureDetectorServicer):
    def __init__(self, node_id):
        self.node_id = node_id
        # membership_list: { node_id: { 'address': str, 'last_heard': float, 'status': 'alive' or 'failed' } }
        self.membership_list = {}
        self.lock = threading.Lock()

    def Ping(self, request, context):
        print(f"Component FailureDetector of Node {self.node_id} runs RPC Ping called by Component FailureDetector of Node {request.sender.node_id}")
        return swim_pb2.PingResponse(alive=True, message="Ack")

    def IndirectPing(self, request, context):
        print(f"Component FailureDetector of Node {self.node_id} runs RPC IndirectPing called by Component FailureDetector of Node {request.requester.node_id}")
        target = request.target_node_id
        with self.lock:
            if target not in self.membership_list:
                return swim_pb2.PingReqResponse(alive=False, message="Target not found")
            target_addr = self.membership_list[target]['address']
        try:
            channel = grpc.insecure_channel(target_addr)
            stub = swim_pb2_grpc.FailureDetectorStub(channel)
            sender = swim_pb2.NodeInfo(node_id=self.node_id, address="localhost")
            req = swim_pb2.PingRequest(sender=sender, target_node_id=target)
            print(f"Component FailureDetector of Node {self.node_id} sends RPC Ping (Indirect) to Component FailureDetector of Node {target}")
            resp = stub.Ping(req, timeout=3)
            return swim_pb2.PingReqResponse(alive=resp.alive, message=resp.message)
        except Exception as e:
            return swim_pb2.PingReqResponse(alive=False, message=str(e))

    def UpdateMembership(self, request, context):
        with self.lock:
            new_members = {}
            for member in request.membership_list:
                new_members[member.node_id] = {
                    'address': member.address,
                    'last_heard': time.time(),
                    'status': 'alive'
                }
            self.membership_list = new_members
        print(f"Component FailureDetector of Node {self.node_id} updated its membership list.")
        return swim_pb2.Empty()

def run_server(node_id, port, membership_list):
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    servicer = FailureDetectorServicer(node_id)
    for entry in membership_list:
        parts = entry.split(':')
        if len(parts) == 2:
            nid, addr = parts
        elif len(parts) == 3:
            nid, host, p = parts
            addr = f"{host}:{p}"
        else:
            print(f"Error: invalid membership entry: {entry}")
            continue
        servicer.membership_list[nid] = {'address': addr, 'last_heard': time.time(), 'status': 'alive'}
    swim_pb2_grpc.add_FailureDetectorServicer_to_server(servicer, server)
    server.add_insecure_port(f'[::]:{port}')
    server.start()
    print(f"FailureDetector server for Node {node_id} started on port {port}")
    return server, servicer

def multicast_failure(servicer, target):
    with servicer.lock:
        if servicer.membership_list[target]['status'] == 'failed':
            return
        servicer.membership_list[target]['status'] = 'failed'
    print(f"Component FailureDetector of Node {servicer.node_id} marks Node {target} as failed")
    for member in list(servicer.membership_list.keys()):
        if member == servicer.node_id or member == target:
            continue
        addr = f"{member}_dissemination:60051"
        try:
            channel = grpc.insecure_channel(addr)
            stub = swim_pb2_grpc.DisseminationStub(channel)
            msg = swim_pb2.DisseminationMessage(failed_node_id=target)
            print(f"Component FailureDetector of Node {servicer.node_id} sends RPC Disseminate to Component Dissemination of Node {member} for failure of Node {target}")
            stub.Disseminate(msg, timeout=3)
        except Exception as e:
            print(f"Error disseminating failure to {member}: {e}")
    with servicer.lock:
        if target in servicer.membership_list:
            del servicer.membership_list[target]
            print(f"Component FailureDetector of Node {servicer.node_id} removes Node {target} from membership list")

def periodic_ping(servicer):
    """
    Periodically sends direct pings to a random alive node.
    If the direct ping fails, sends indirect pings to every other alive node.
    If none respond, marks the target as failed.
    """
    while True:
        time.sleep(T_PING)
        # Acquire lock to safely access membership_list
        with servicer.lock:
            # Gather all nodes that are 'alive' and not self
            alive_nodes = [
                nid for nid, info in servicer.membership_list.items()
                if nid != servicer.node_id and info['status'] == 'alive'
            ]

        # If there are no alive nodes other than self, do nothing this cycle
        if not alive_nodes:
            continue

        # Choose a random alive node to ping
        target = random.choice(alive_nodes)
        with servicer.lock:
            target_addr = servicer.membership_list[target]['address']

        # Attempt direct ping
        try:
            channel = grpc.insecure_channel(target_addr)
            stub = swim_pb2_grpc.FailureDetectorStub(channel)
            sender_info = swim_pb2.NodeInfo(node_id=servicer.node_id, address="localhost")
            ping_request = swim_pb2.PingRequest(sender=sender_info, target_node_id=target)

            print(f"Component FailureDetector of Node {servicer.node_id} "
                  f"sends RPC Ping to Component FailureDetector of Node {target}")

            response = stub.Ping(ping_request, timeout=3)
            if response.alive:
                # Direct ping succeeded; update last_heard
                with servicer.lock:
                    servicer.membership_list[target]['last_heard'] = time.time()
                continue  # Move on to next cycle
        except Exception as e:
            print(f"Direct Ping to Node {target} failed: {e}")

        # Direct ping failed; attempt indirect pings from every other alive node
        with servicer.lock:
            indirect_candidates = [
                nid for nid in servicer.membership_list
                if nid not in [servicer.node_id, target]
                and servicer.membership_list[nid]['status'] == 'alive'
            ]

        print(f"Component FailureDetector of Node {servicer.node_id} "
              f"sends RPC IndirectPing to all candidates {indirect_candidates} "
              f"for Component FailureDetector of Node {target}")

        indirect_success = False
        for ind in indirect_candidates:
            with servicer.lock:
                ind_addr = servicer.membership_list[ind]['address']
            try:
                channel = grpc.insecure_channel(ind_addr)
                stub = swim_pb2_grpc.FailureDetectorStub(channel)
                sender_info = swim_pb2.NodeInfo(node_id=servicer.node_id, address="localhost")
                ping_req_request = swim_pb2.PingReqRequest(requester=sender_info, target_node_id=target)

                print(f"Component FailureDetector of Node {servicer.node_id} "
                      f"sends RPC IndirectPing to Component FailureDetector of Node {ind}")

                ping_req_response = stub.IndirectPing(ping_req_request, timeout=3)
                if ping_req_response.alive:
                    # Indirect ping succeeded
                    indirect_success = True
                    with servicer.lock:
                        servicer.membership_list[target]['last_heard'] = time.time()
                    break
            except Exception as e:
                print(f"IndirectPing to Node {ind} for target Node {target} failed: {e}")

        # If no indirect ping succeeded, mark target as failed
        if not indirect_success:
            multicast_failure(servicer, target)
            print(f"Component FailureDetector of Node {servicer.node_id} "
                  f"notifies Dissemination about failure of Node {target}")

if __name__ == '__main__':
    if len(sys.argv) < 4:
        print("Usage: python failure_detector.py <node_id> <port> <membership_list>")
        sys.exit(1)
    node_id = sys.argv[1]
    port = sys.argv[2]
    mem_str = sys.argv[3]
    membership_list = [x.strip() for x in mem_str.split(',')]
    server, servicer = run_server(node_id, port, membership_list)
    t = threading.Thread(target=periodic_ping, args=(servicer,))
    t.daemon = True
    t.start()
    try:
        while True:
            time.sleep(60)
    except KeyboardInterrupt:
        server.stop(0)

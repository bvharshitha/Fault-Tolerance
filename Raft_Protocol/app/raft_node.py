import grpc
import raft_pb2
import raft_pb2_grpc
from concurrent import futures
import threading
import time
import random
import sys
import datetime

FOLLOWER, CANDIDATE, LEADER = 'Follower', 'Candidate', 'Leader'

def log(node_id, msg):
    timestamp = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"[{timestamp}] Node {node_id} | {msg}")

class RaftNode(raft_pb2_grpc.RaftServicer):
    def __init__(self, node_id, peers):
        self.node_id = node_id
        self.peers = peers  # dict: node_id -> address
        self.term = 0
        self.state = FOLLOWER
        self.voted_for = None
        self.vote_count = 0
        self.lock = threading.Lock()
        self.heartbeat_received = False

        self.reset_election_timeout()
        log(self.node_id, "Started as FOLLOWER with election timeout between 1.5–3s")

        threading.Thread(target=self.election_timer, daemon=True).start()

    def reset_election_timeout(self):
        self.election_timeout = time.time() + random.uniform(1.5, 3.0)

    def election_timer(self):
        while True:
            time.sleep(0.1)
            if self.state != LEADER and time.time() > self.election_timeout:
                log(self.node_id, "Election timeout reached, no heartbeat received. Starting election...")
                self.start_election()

    def start_election(self):
        with self.lock:
            self.state = CANDIDATE
            self.term += 1
            self.voted_for = self.node_id
            self.vote_count = 1
            self.reset_election_timeout()
            log(self.node_id, f"Became CANDIDATE in Term {self.term}, voted for self")

        for peer_id, address in self.peers.items():
            threading.Thread(target=self.send_request_vote, args=(peer_id, address), daemon=True).start()

    def send_request_vote(self, peer_id, address):
        try:
            with grpc.insecure_channel(address) as channel:
                stub = raft_pb2_grpc.RaftStub(channel)
                log(self.node_id, f"Sends RPC RequestVote to Node {peer_id}")
                response = stub.RequestVote(raft_pb2.VoteRequest(term=self.term, candidateId=self.node_id))
                with self.lock:
                    if response.term > self.term:
                        log(self.node_id, f"Received higher term {response.term} from Node {peer_id}, reverting to FOLLOWER")
                        self.term = response.term
                        self.state = FOLLOWER
                        self.voted_for = None
                    elif response.voteGranted:
                        log(self.node_id, f"Received vote from Node {peer_id}: GRANTED (Term {response.term})")
                        self.vote_count += 1
                        if self.vote_count > (len(self.peers) + 1) // 2 and self.state == CANDIDATE:
                            self.become_leader()
                    else:
                        log(self.node_id, f"Received vote from Node {peer_id}: REJECTED (Term {response.term})")
        except Exception as e:
            log(self.node_id, f"Error contacting Node {peer_id} for vote: {e}")

    def become_leader(self):
        self.state = LEADER
        log(self.node_id, f"Won election with majority votes. Became LEADER in Term {self.term}")
        threading.Thread(target=self.heartbeat_loop, daemon=True).start()

    def heartbeat_loop(self):
        while self.state == LEADER:
            for peer_id, address in self.peers.items():
                threading.Thread(target=self.send_append_entries, args=(peer_id, address), daemon=True).start()
            time.sleep(1)

    def send_append_entries(self, peer_id, address):
        try:
            with grpc.insecure_channel(address) as channel:
                stub = raft_pb2_grpc.RaftStub(channel)
                log(self.node_id, f"Sends AppendEntries (heartbeat) to Node {peer_id}")
                stub.AppendEntries(raft_pb2.AppendRequest(term=self.term, leaderId=self.node_id))
        except Exception as e:
            log(self.node_id, f"Error sending heartbeat to Node {peer_id}: {e}")

    def RequestVote(self, request, context):
        log(self.node_id, f"Received RPC RequestVote from Node {request.candidateId} (Term {request.term})")
        with self.lock:
            if request.term < self.term:
                log(self.node_id, f"Rejected vote to Node {request.candidateId} (Stale Term {request.term})")
                return raft_pb2.VoteResponse(term=self.term, voteGranted=False)

            if request.term > self.term:
                self.term = request.term
                self.voted_for = None
                self.state = FOLLOWER

            vote_granted = False
            if self.voted_for in [None, request.candidateId]:
                self.voted_for = request.candidateId
                vote_granted = True
                self.reset_election_timeout()

            log(self.node_id, f"Voted {'YES' if vote_granted else 'NO'} for Node {request.candidateId} in Term {self.term}")
            return raft_pb2.VoteResponse(term=self.term, voteGranted=vote_granted)

    def AppendEntries(self, request, context):
        log(self.node_id, f"Received heartbeat from Leader {request.leaderId} (Term {request.term})")
        with self.lock:
            if request.term < self.term:
                return raft_pb2.AppendResponse(term=self.term, success=False)

            self.term = request.term
            self.state = FOLLOWER
            self.voted_for = request.leaderId
            self.reset_election_timeout()
            return raft_pb2.AppendResponse(term=self.term, success=True)
        
    def GetLeader(self, request, context):
        log(self.node_id, f"Runs RPC GetLeader called by Client")
        return raft_pb2.LeaderResponse(leaderId=self.voted_for if self.voted_for is not None else -1)


def serve(node_id, peers, port):
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    raft_pb2_grpc.add_RaftServicer_to_server(RaftNode(node_id, peers), server)
    server.add_insecure_port(f'[::]:{port}')
    server.start()
    log(node_id, f"Started server on port {port}")
    server.wait_for_termination()

if __name__ == '__main__':
    node_id = int(sys.argv[1])
    port = 50050 + node_id
    peers = {i: f"raft{i}:5005{i}" for i in range(1, 6) if i != node_id}
    serve(node_id, peers, port)

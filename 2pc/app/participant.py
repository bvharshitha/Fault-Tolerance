import grpc
import os
from concurrent import futures
from app import vote_pb2, vote_pb2_grpc
from datetime import datetime
CONTROL_FILE = "/app/app/participants_votes.txt";

class VoteService(vote_pb2_grpc.VoteServiceServicer):
    def __init__(self, participant_id):
        self.participant_id = participant_id

    def read_decision(self):
        try:
            with open(CONTROL_FILE, "r") as f:
                for line in f:
                    if '=' in line:
                        pid, decision = line.strip().split('=', 1)
                        if pid.strip() == self.participant_id:
                            return decision.strip().upper()
            print(f"No explicit decision found for '{self.participant_id}', defaulting to COMMIT")
            return "COMMIT"
        except FileNotFoundError:
            print(f"Decision file '{CONTROL_FILE}' not found, defaulting to COMMIT")
            return "COMMIT"

    def VoteRequest(self, request, context):
        print(f"Phase voting of Node {self.participant_id} Received VoteRequest from Phase voting of Node Coordinator for transaction {request.transaction_id}")

        decision_str = self.read_decision()
        if decision_str == "ABORT":
            decision = vote_pb2.VoteResponse.ABORT
        else:
            decision = vote_pb2.VoteResponse.COMMIT

        print(f"Phase voting of Node {self.participant_id} Sending vote: {decision_str}")
        return vote_pb2.VoteResponse(vote=decision, participant_id=self.participant_id)

def run_participant():
    port = os.environ.get("PORT", "50051")
    participant_id = os.environ.get("PARTICIPANT_ID", "unknown")
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=5))
    vote_pb2_grpc.add_VoteServiceServicer_to_server(VoteService(participant_id), server)
    server.add_insecure_port(f'[::]:{port}')
    print(f"node {participant_id} Voting gRPC server running on port {port}")
    server.start()
    server.wait_for_termination()

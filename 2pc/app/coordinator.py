import grpc
import time
from app import vote_pb2, vote_pb2_grpc
from datetime import datetime

PARTICIPANTS = [
    'participant1:50051',
    'participant2:50052',
    'participant3:50053',
    'participant4:50054',
]

DECISION_FILE = "/shared/decision.txt"

def run_coordinator():
    time.sleep(10)
    transaction_id = "txn-123"
    votes = []

    for participant in PARTICIPANTS:
        time.sleep(0.2)
        channel = grpc.insecure_channel(participant)
        stub = vote_pb2_grpc.VoteServiceStub(channel)
        print(f"Phase voting of Node coordinator sends RPC VoteRequest to Phase voting of Node {participant}")
        try:
            response = stub.VoteRequest(vote_pb2.VoteRequestMessage(transaction_id=transaction_id))
            votes.append(response.vote)
        except grpc.RpcError:
            print(f"Coordinator Failed to contact {participant}")
            votes.append(vote_pb2.VoteResponse.ABORT)

    final_decision = "commit" if all(v == vote_pb2.VoteResponse.COMMIT for v in votes) else "abort"

    if final_decision == "commit":
        print("Coordinator All voted COMMIT")
    else:
        print("Coordinator Recieved One or more voted ABORT")

    # Write decision to shared file
    with open(DECISION_FILE, "w") as f:
        f.write(final_decision)

if __name__ == "__main__":
    run_coordinator()

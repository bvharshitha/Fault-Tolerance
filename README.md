## Project Structure

This repository contains three separate implementations of fault tolerance protocols in distributed systems. For simplicity, all three projects are placed in a single repository. Each folder corresponds to an individual protocol:

1. **SWIM Protocol** – Failure detection and membership updates using direct/indirect pinging.
2. **Two-Phase Commit (2PC)** – Transaction coordination with vote and decision phases across distributed nodes.
3. **Raft Protocol** – Consensus algorithm with leader election, log replication, and consistent state management.

Each folder contains all relevant code, gRPC `.proto` files, Docker configurations, and execution instructions specific to the respective protocol.

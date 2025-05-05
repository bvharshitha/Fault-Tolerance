const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

const PROTO_PATH = path.join(__dirname, '..', 'proto', 'raft.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH);
const raftProto = grpc.loadPackageDefinition(packageDefinition).raft;

const electionNodeId = Math.floor(Math.random() * 5) + 1;
const electionAddr = `localhost:5005${electionNodeId}`;
const electionStub = new raftProto.Raft(electionAddr, grpc.credentials.createInsecure());

const operation = `SET x=${Math.floor(Math.random() * 100)}`;

console.log(`sClient wants to execute: ${operation}`);

electionStub.GetLeader({}, (err, response) => {
  if (err || response.leaderId === -1) {
    console.error(`Failed to get leader from Node ${electionNodeId}:`, err?.message || 'No leader known');
    return;
  }

  const leaderId = response.leaderId;
  console.log(`Node Client received leader info: Leader is Node ${leaderId}`);

  const randomNodeId = Math.floor(Math.random() * 5) + 1;
  const target = `localhost:600${randomNodeId}`;
  const logStub = new raftProto.Raft(target, grpc.credentials.createInsecure());

  console.log(`Node Client sends RPC ClientOperation to Node ${randomNodeId}`);
  logStub.ClientOperation({ operation }, (err2, res) => {
    if (err2) {
      console.error(`Error from Node ${randomNodeId}:`, err2.message);
    } else {
      console.log(`Node Client received response from Node ${leaderId}: ${res.result}`);
    }
  });
});
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const PROTO_PATH = path.join(__dirname, 'proto', 'raft.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH);
const raftProto = grpc.loadPackageDefinition(packageDefinition).raft;

const nodeId = parseInt(process.argv[2]);
const port = 6000 + nodeId;

const peers = {};
for (let i = 1; i <= 5; i++) {
  if (i !== nodeId) peers[i] = `js-node${i}:600${i}`;
}

let term = 1;
let state = 'FOLLOWER';
let leaderId = null;

let logEntries = [];
let commitIndex = -1;
let lastApplied = -1;
let ackCountMap = {};
const clientCallbacks = {}; // Store callbacks until entries are committed

function log(msg) {
  const t = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`[${t}] Node ${nodeId} | ${msg}`);
}

function isMajority(count) {
  return count > Object.keys(peers).length / 2;
}

function fetchLeaderId(callback) {
  const randomElectionNode = Math.floor(Math.random() * 5) + 1;
  const electionAddr = `raft${randomElectionNode}:5005${randomElectionNode}`;
  const electionStub = new raftProto.Raft(electionAddr, grpc.credentials.createInsecure());

  electionStub.GetLeader({}, (err, res) => {
    if (err || res.leaderId === -1) {
      log(`❌ Node ${nodeId} failed to get leader from Election Node ${randomElectionNode}`);
      return callback(null);
    }
    leaderId = res.leaderId;
    callback(leaderId);
  });
}

function sendAppendEntries() {
  for (const [peerId, address] of Object.entries(peers)) {
    const peer = new raftProto.Raft(address, grpc.credentials.createInsecure());
    log(`Node ${nodeId} sends RPC AppendEntries to Node ${peerId}`);
    peer.AppendEntries({ term, leaderId: nodeId, entries: logEntries, commitIndex }, (err, response) => {
      if (err) return log(`Failed to reach Node ${peerId}`);
      log(`Node ${peerId} runs RPC AppendEntries called by Node ${nodeId}`);
      const lastIdx = logEntries.length - 1;
      if (response.success) {
        ackCountMap[lastIdx] = (ackCountMap[lastIdx] || 1) + 1;
        if (isMajority(ackCountMap[lastIdx]) && commitIndex < lastIdx) {
          commitIndex = lastIdx;
          applyCommittedLogs();
        }
      }
    });
  }
}

function applyCommittedLogs() {
  while (lastApplied < commitIndex) {
    lastApplied++;
    const entry = logEntries[lastApplied];
    log(`Committed log entry ${lastApplied}: ${entry.operation}`);

    // Send ACK to client if callback exists
    if (clientCallbacks[lastApplied]) {
      clientCallbacks[lastApplied](null, {
        result: `✅ Operation '${entry.operation}' committed at index ${lastApplied}`
      });
      delete clientCallbacks[lastApplied];
    }
  }
}

function handleClientOperation(call, callback) {
  log(`Node ${nodeId} runs RPC ClientOperation called by Client`);

  if (state !== 'LEADER') {
    if (!leaderId) {
        return fetchLeaderId((lid) => {
          if (!lid) return callback(null, { result: 'Leader unknown. Cannot forward.' });

          if (lid === nodeId) {
            log(`Node ${nodeId} is the actual leader. Handling operation directly.`);
            return handleAsLeader(call, callback);
          }

          const forwardStub = new raftProto.Raft(`js-node${lid}:600${lid}`, grpc.credentials.createInsecure());
          log(`Node ${nodeId} sends RPC ClientOperation to Node ${lid}`);
          return forwardStub.ClientOperation(call.request, callback);
        });
      }

      if (leaderId === nodeId) {
        log(`Node ${nodeId} is the actual leader. Handling operation directly.`);
        return handleAsLeader(call, callback);
      }

      const forwardStub = new raftProto.Raft(`js-node${leaderId}:600${leaderId}`, grpc.credentials.createInsecure());
      log(`Node ${nodeId} sends RPC ClientOperation to Node ${leaderId}`);
      return forwardStub.ClientOperation(call.request, callback);      
  }

  const operation = call.request.operation;
  const newEntry = { operation, term, index: logEntries.length };
  logEntries.push(newEntry);
  ackCountMap[newEntry.index] = 1;
  clientCallbacks[newEntry.index] = callback;

  log(`Appended <${operation}, ${term}, ${newEntry.index}> to log`);
  sendAppendEntries();
}

function handleAsLeader(call, callback) {
  const operation = call.request.operation;
  const newEntry = { operation, term, index: logEntries.length };
  logEntries.push(newEntry);
  ackCountMap[newEntry.index] = 1;
  clientCallbacks[newEntry.index] = callback;

  log(`Appended <${operation}, ${term}, ${newEntry.index}> to log`);
  sendAppendEntries();
}

function handleAppendEntries(call, callback) {
  const { term: leaderTerm, leaderId: incomingLeader, entries, commitIndex: newCommitIndex } = call.request;
  log(`Node ${nodeId} runs RPC AppendEntries called by Node ${incomingLeader}`);

  if (leaderTerm < term) return callback(null, { term, success: false });

  state = 'FOLLOWER';
  term = leaderTerm;
  leaderId = incomingLeader;
  logEntries = entries;
  log(`Updated log from leader. Total entries: ${logEntries.length}`);

  while (lastApplied < newCommitIndex) {
    lastApplied++;
  }
  log(`✅ Node ${nodeId} sends ACK for AppendEntries to Leader ${incomingLeader}`);
  callback(null, { term, success: true });
}

function handleRequestVote(call, callback) {
  const { candidateId, term: candidateTerm } = call.request;
  log(`Node ${nodeId} runs RPC RequestVote called by Node ${candidateId}`);
  callback(null, { term, voteGranted: false });
}

function startServer() {
  const server = new grpc.Server();
  server.addService(raftProto.Raft.service, {
    ClientOperation: handleClientOperation,
    AppendEntries: handleAppendEntries,
    RequestVote: handleRequestVote
  });
  server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), () => {
    log(`Raft server started on port ${port}`);
  });
}

startServer();

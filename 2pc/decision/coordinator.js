// coordinator.js (Node.js - Decision Phase)
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require("path");
const fs = require("fs");

// Load proto definition clearly with enums as strings
const packageDefinition = protoLoader.loadSync(path.join(__dirname, "vote.proto"), {
  enums: String, // clearly defines enums as strings
  keepCase: true // important fix to keep field names exact as defined
});
const voteProto = grpc.loadPackageDefinition(packageDefinition).vote;

const participants = [
  'decision1:50055',
  'decision2:50056',
  'decision3:50057',
  'decision4:50058',
];

const coordinatorId = process.env.PARTICIPANT_ID || "coordinator";
const decisionFilePath = "/shared/decision.txt";

function waitForDecisionFile(callback) {
  const interval = setInterval(() => {
    if (fs.existsSync(decisionFilePath)) {
      clearInterval(interval);
      const content = fs.readFileSync(decisionFilePath, "utf8").trim();
      callback(content);
    }
  }, 1000);
}

waitForDecisionFile((finalDecision) => {
  const decisionEnum = finalDecision === "abort"
    ? "GLOBAL_ABORT"
    : "GLOBAL_COMMIT";

  const decisionText = decisionEnum.replace("_", " ");

  participants.forEach((address) => {
    const client = new voteProto.VoteService(address, grpc.credentials.createInsecure());

    // transaction_id now correctly matches proto definition explicitly
    const decisionMessage = {
      decision: decisionEnum,
      transaction_id: "txn-123" 
    };

    console.log(`Phase decision of Node ${coordinatorId} sends RPC ${decisionText} to Phase decision of Node ${address}`);

    client.DecisionNotify(decisionMessage, (err, res) => {
      if (err) {
        console.error(`❌ Error contacting ${address}:`, err.message);
      }
    });
  });
});

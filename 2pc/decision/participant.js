const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require("path");

const packageDefinition = protoLoader.loadSync(path.join(__dirname, "vote.proto"), {
  enums: String,  // Match coordinator exactly
  keepCase: true // explicitly matches coordinator

});
const voteProto = grpc.loadPackageDefinition(packageDefinition).vote;

const participantId = process.env.PARTICIPANT_ID || "unknown";
const port = process.env.DECISION_PORT || "50055";

const server = new grpc.Server();

server.addService(voteProto.VoteService.service, {
  DecisionNotify: (call, callback) => {
    const decision = call.request.decision;
    const txnId = call.request.transaction_id;

    const decisionText = decision.replace("_", " ");

    console.log(`Phase decision of Node ${participantId} receives RPC ${decisionText} from Phase decision of Node coordinator for transaction ${txnId}`);

    if (decision === "GLOBAL_COMMIT") {
      console.log(`${participantId}: Locally committing transaction ${txnId}`);
    } else {
      console.log(`${participantId}: Locally aborting transaction ${txnId}`);
    }

    callback(null, { message: `ACK from ${participantId}` });
  }
});

server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), () => {
  console.log(`Decision server for ${participantId} running on port ${port}`);
});

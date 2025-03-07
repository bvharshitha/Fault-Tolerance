#!/usr/bin/env node
'use strict';

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const PROTO_PATH = './swim.proto';
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const protoDescriptor = grpc.loadPackageDefinition(packageDefinition).swim;
const disseminationService = protoDescriptor.Dissemination;

// Mapping from node IDs to their failure detector endpoints.
const failureEndpoints = {
  node1: "node1_failure:50051",
  node2: "node2_failure:50052",
  node3: "node3_failure:50053",
  node4: "node4_failure:50054",
  node5: "node5_failure:50055",
  node6: "node6_failure:50056"
};

const nodeId = process.env.NODE_ID || process.argv[2] || "node_js";
const port = process.env.PORT || process.argv[3] || "60051";

// Build membership list from environment variable.
let membershipList = {};
if (process.env.MEMBERSHIP_LIST) {
  process.env.MEMBERSHIP_LIST.split(',').forEach(entry => {
    const parts = entry.split(':');
    if (parts.length === 2) {
      membershipList[parts[0]] = { address: parts[1], status: 'alive' };
    } else if (parts.length === 3) {
      membershipList[parts[0]] = { address: `${parts[1]}:${parts[2]}`, status: 'alive' };
    }
  });
}
membershipList[nodeId] = { address: `localhost:${port}`, status: 'alive' };

function Disseminate(call, callback) {
  console.log(`Component Dissemination of Node ${nodeId} runs RPC Disseminate called by Component Unknown`);
  const failedId = call.request.failed_node_id;
  if (membershipList[failedId] && membershipList[failedId].status !== 'failed') {
    membershipList[failedId].status = 'failed';
    console.log(`Component Dissemination of Node ${nodeId} marks Node ${failedId} as failed`);
  } else {
    console.log(`Failed node ${failedId} not found or already marked in membership list of Node ${nodeId}`);
  }
  callback(null, {});
}

function Join(call, callback) {
  console.log(`Component Dissemination of Node ${nodeId} runs RPC Join called by Component ${call.request.new_node.node_id} of Node ${call.request.new_node.node_id}`);
  
  // Remove any failed nodes.
  for (let id in membershipList) {
    if (membershipList[id].status === 'failed') {
      console.log(`Component Dissemination of Node ${nodeId} removes failed Node ${id} from its membership list`);
      delete membershipList[id];
    }
  }
  // Add the new node.
  const newId = call.request.new_node.node_id;
  const newAddr = call.request.new_node.address;
  membershipList[newId] = { address: newAddr, status: 'alive' };
  console.log(`Component Dissemination of Node ${nodeId} adds Node ${newId} to its membership list`);
  
  // Build updated membership array using failure endpoints.
  const memArray = [];
  for (let id in membershipList) {
    if (membershipList[id].status === 'alive') {
      // Use failureEndpoints mapping for the updated membership list.
      const fdEndpoint = failureEndpoints[id] || membershipList[id].address;
      memArray.push({ node_id: id, address: fdEndpoint });
    }
  }
  console.log(`Component Dissemination of Node ${nodeId} sends RPC Join response to Component Dissemination of Node ${newId}`);
  callback(null, { membership_list: memArray });
}

function getServer() {
  const server = new grpc.Server();
  server.addService(disseminationService.service, { Disseminate, Join });
  return server;
}

if (require.main === module) {
  const server = getServer();
  server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), (err, boundPort) => {
    if (err) {
      console.error("Error binding server:", err);
      return;
    }
    console.log(`Component Dissemination of Node ${nodeId} started on port ${boundPort}`);
  });
}

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

// Create clients for Dissemination and FailureDetector services.
const disseminationService = protoDescriptor.Dissemination;
const failureDetectorService = protoDescriptor.FailureDetector;

// Read configuration from environment or command-line arguments.
const bootstrapAddress = process.env.BOOTSTRAP_ADDRESS || process.argv[2] || "node1_dissemination:60051";
const newNodeId = process.env.NODE_ID || process.argv[3] || "node6";
const newNodeAddress = process.env.NODE_ADDRESS || process.argv[4] || "node6_failure:50056";
// Local failure detector address for node6
const localFailureDetectorAddress = process.env.LOCAL_FAILURE_DETECTOR || "node6_failure:50056";

function sendJoinRequest() {
  const joinClient = new disseminationService(bootstrapAddress, grpc.credentials.createInsecure());
  console.log(`Component Dissemination of Node ${newNodeId} sends RPC Join to Component Dissemination of Bootstrap Node at ${bootstrapAddress}`);
  
  joinClient.Join({ new_node: { node_id: newNodeId, address: newNodeAddress } }, (err, response) => {
    if (err) {
      console.error("Join request failed:", err);
    } else {
      console.log(`Component Dissemination of Node ${newNodeId} successfully joined the cluster.`);
      // After a successful join, update the local membership list of node6's failure detector.
      updateLocalMembership(response.membership_list);
    }
  });
}

function updateLocalMembership(membershipArray) {
  const updateReq = { membership_list: membershipArray };
  const fdClient = new failureDetectorService(localFailureDetectorAddress, grpc.credentials.createInsecure());
  if (typeof fdClient.UpdateMembership !== 'function') {
    console.error("UpdateMembership is not available. Ensure your proto file includes the UpdateMembership RPC and that stubs are regenerated.");
    return;
  }
  fdClient.UpdateMembership(updateReq, (err, _) => {
    if (err) {
      console.error("UpdateMembership failed:", err);
    } else {
      console.log(`Component FailureDetector of Node ${newNodeId} updated its membership list successfully.`);
    }
  });
}

// Execute the join request.
sendJoinRequest();

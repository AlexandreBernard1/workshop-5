import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value } from "../types";
import { delay } from "../utils";

type NodeState = {
  killed: boolean; 
  x: 0 | 1 | "?" | null; 
  decided: boolean | null; 
  k: number | null; 
};
export async function node(
  nodeId: number, 
  N: number, 
  F: number, 
  initialValue: Value, 
  isFaulty: boolean, 
  nodesAreReady: () => boolean, 
  setNodeIsReady: (index: number) => void 
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  const state: NodeState = {
    killed: false,
    x: initialValue,
    decided: false,
    k: 0,
  };

  let proposals: Map<number, Value[]> = new Map();
  let votes: Map<number, Value[]> = new Map();
  
  // TODO implement this
  // this route allows retrieving the current status of the node
  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send('faulty');
    } else {
      res.status(200).send('live');
    }
  });

  // TODO implement this
  // this route allows the node to receive messages from other nodes
  // I want to implement this route with function like the broadcast in the toute start but i got somme issues so i put all the codes in one route
  // The intitial idea is to have two functions handlePhase1 and handlePhase2 to handle the two phases of the algorithm
  // These functions are still in the code but not used
  node.post("/message", async (req, res) => { // first phase of the algorithm
    let { k, x, type } = req.body;
    if (!state.killed && !isFaulty) {
      if (type == "2P") {
        if (!proposals.has(k)) proposals.set(k, []);
        proposals.get(k)!.push(x);
        const proposal = proposals.get(k)!;
        if (proposal.length >= N - F) {
          const CN = proposal.filter((x) => x == 0).length;
          const CY = proposal.filter((x) => x == 1).length;
          x = CN > N / 2 ? 0 : CY > N / 2 ? 1 : "?";
          for (let i = 0; i < N; i++) {
            fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ k, x, type: "2V" }),
            });
          }
        }
      } else if (type == "2V") { // second phase of the algorithm
        if (!votes.has(k)) votes.set(k, []);
        votes.get(k)!.push(x);
        const vote = votes.get(k)!;
        if (vote.length >= N - F) {
          const CN = vote.filter((x) => x == 0).length;
          const CY = vote.filter((x) => x == 1).length;
          if (CN >= F + 1) {
            state.x = 0;
            state.decided = true;
          } else if (CY >= F + 1) {
            state.x = 1;
            state.decided = true;
          } else {
            state.x = CN + CY > 0 && CN > CY ? 0 : CN + CY > 0 && CN < CY ? 1 : Math.random() > 0.5 ? 0 : 1;
            state.k = k + 1;
            for (let i = 0; i < N; i++) {
              fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ k: state.k, x: state.x, type: "2P" }),
              });
            }
          }
        }
      }
    }
    res.status(200).send("success");
  });
  
  // function to handle the first phase of the algorithm
  async function handlePhase1(k: number, x: Value) {
    if (!proposals.has(k)) proposals.set(k, []);
    proposals.get(k)!.push(x);
  
    const proposal = proposals.get(k)!;
    if (proposal.length >= N - F) {
      const CN = proposal.filter(val => val === 0).length;
      const CY = proposal.filter(val => val === 1).length;
      const newX = CN > N / 2 ? 0 : CY > N / 2 ? 1 : "?";
      await broadcastMessage({ k, x: newX, type: "2V" });
    }
  }
  
  // function to handle the second phase of the algorithm
  async function handlePhase2(k: number, x: Value) {
    if (!votes.has(k)) votes.set(k, []);
    votes.get(k)!.push(x);
  
    const vote = votes.get(k)!;
    if (vote.length >= N - F) {
      const CN = vote.filter(val => val === 0).length;
      const CY = vote.filter(val => val === 1).length;
  
      if (CN >= F + 1) {
        state.x = 0;
        state.decided = true;
      } else if (CY >= F + 1) {
        state.x = 1;
        state.decided = true;
      } else {
        state.x = CN > CY ? 0 : CN < CY ? 1 : Math.random() > 0.5 ? 0 : 1;
        state.k = k + 1;
        await broadcastMessage({ k: state.k, x: state.x, type: "2P" });
      }
    }
  }
  

  // TODO implement this
  // this route is used to start the consensus algorithm
  node.get("/start", async (req, res) => {
    while (!nodesAreReady()) { await delay(100);}
    if (!isFaulty) {
      state.k = 1;
      state.x = initialValue;
      state.decided = false;
      await broadcastMessage({ k: state.k, x: state.x, type: "2P" });
    } else {
      state.decided = null;
      state.x = null;
      state.k = null;
    }
    res.status(200).send("success");
  });

  async function broadcastMessage(message: { k: number, x: any, type: string }) {
    const promises = [];
    for (let i = 0; i < N; i++) {
      promises.push(
        fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(message),
        })
      );
    }
    await Promise.all(promises);
  }

  // TODO implement this
  // this route is used to stop the consensus algorithm
  node.get("/stop", async (req, res) => {
    state.killed = true;
    state.x = null;
    state.decided = null;
    state.k = 0;
    res.send("Node stopped");
  });

  // TODO implement this
  // get the current state of a node
  node.get("/getState", (req, res) => {
    const responseState: NodeState = isFaulty ? { killed: state.killed, x: null, decided: null, k: null } : state;
    res.status(200).json(responseState);
  });

  //Pour faire des testes
  const sendToAllNodes = async (message: any) => {
    // Send the message to each node in the network
    for (let nodeId = 0; nodeId < N; nodeId++) {
      try {
        await fetch(`http://localhost:${BASE_NODE_PORT + nodeId}/message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(message)
        });
      } catch (error) {
        console.error(`Error sending message to node ${nodeId}:`);
      }
    }
  };
  

  // start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}

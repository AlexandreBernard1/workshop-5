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
  // Fonction pour envoyer des messages à un noeud spécifique
async function sendMessage(nodePort: number, message: any) {
  try {
    await fetch(`http://localhost:${nodePort}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
  } catch (error) {
    console.error(`Erreur lors de l'envoi du message au port ${nodePort}:`, error);
  }
}

node.post("/message", async (req, res) => {
  // première phase de l'algorithme
  let { k, x, type } = req.body;
  if (!state.killed && !isFaulty) {
    if (type == "propose") {
      if (!proposals.has(k)) proposals.set(k, []);
      proposals.get(k)!.push(x);
      const proposal = proposals.get(k)!;
      if (proposal.length >= N - F) {
        const cst1 = proposal.filter((x) => x == 0).length;
        const cst2 = proposal.filter((x) => x == 1).length;
        if (cst1 > N / 2) {
          x = 0;
        } else if (cst2 > N / 2) {
          x = 1;
        } else {
          x = "?";
        }
        for (let i = 0; i < N; i++) {
          await sendMessage(BASE_NODE_PORT + i, { k, x, type: "vote" });
        }
      }
    } else if (type == "vote") { 
      if (!votes.has(k)) votes.set(k, []);
      votes.get(k)!.push(x);
      const vote = votes.get(k)!;
      if (vote.length >= N - F) {
        const cst1 = vote.filter((x) => x == 0).length;
        const cst2 = vote.filter((x) => x == 1).length;
        if (cst1 >= F + 1) {
          state.x = 0;
          state.decided = true;
        } else if (cst2 >= F + 1) {
          state.x = 1;
          state.decided = true;
        } else {
          if (cst1 + cst2 > 0) {
            if (cst1 > cst2) {
              state.x = 0;
            } else {
              state.x = 1;
            }
          } else {
            state.x = Math.random() > 0.5 ? 0 : 1;
          }
                    state.k = k + 1;
          for (let i = 0; i < N; i++) {
            await sendMessage(BASE_NODE_PORT + i, { k: state.k, x: state.x, type: "propose" });
          }
        }
      }
    }
  }
  res.status(200).send("success");
  });

  // TODO implement this
  // this route is used to start the consensus algorithm
  node.get("/start", async (req, res) => {
    while (!nodesAreReady()) { await delay(100);}
    if (!isFaulty) {
      state.k = 1;
      state.x = initialValue;
      state.decided = false;
      await broadcastMessage({ k: state.k, x: state.x, type: "propose" });
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

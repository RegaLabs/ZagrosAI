import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (typeof msg.id !== "number") return;
  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "mock", version: "1.0" },
      },
    });
  } else if (msg.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          {
            name: "mock.echo",
            description: "Echo text",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
            },
          },
        ],
      },
    });
  } else if (msg.method === "tools/call") {
    const params = msg.params ?? {};
    if (params.name === "mock.echo") {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{ type: "text", text: "echo:" + (params.arguments?.text ?? "") }],
          isError: false,
        },
      });
    } else {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [], isError: true },
      });
    }
  } else {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32601, message: "Method not found" },
    });
  }
});

import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "0.2.0",
        agentCapabilities: {},
      },
    });
    return;
  }
  if (msg.method === "session/new") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: { sessionId: "mock-acp-session" },
    });
    return;
  }
  if (msg.method === "session/prompt") {
    const userText = (msg.params?.message?.[0]?.content?.[0]?.text ?? "")
      .replace(/[^\x20-\x7E]/g, "")
      .slice(0, 200);
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: { sessionId: "mock-acp-session", messageId: "mock-message-1" },
    });
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "mock-acp-session",
        messageId: "mock-message-1",
        type: "agent_message",
        item: { type: "agent_message", text: `harness-answered:${userText}` },
      },
    });
    send({
      jsonrpc: "2.0",
      method: "session/update_complete",
      params: { sessionId: "mock-acp-session", messageId: "mock-message-1" },
    });
    return;
  }
  if (msg.method === "session/ping") {
    send({ jsonrpc: "2.0", id: msg.id, result: {} });
    return;
  }
  if (msg.method === "session/close") {
    send({ jsonrpc: "2.0", id: msg.id, result: {} });
    return;
  }
  send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
});

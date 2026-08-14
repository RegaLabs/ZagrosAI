import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_A2A_PORT ?? 9897);
const BASE = `http://127.0.0.1:${PORT}`;

const server = createServer((req, res) => {
  const url = new URL(req.url, BASE);
  res.setHeader("connection", "close");

  if (url.pathname === "/.well-known/agent.json") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        protocolVersion: "1.0",
        name: "mock-remote-agent",
        description: "A mock external A2A agent for verification.",
        url: BASE,
        capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
        security: {},
        skills: [],
      })
    );
    return;
  }

  if (url.pathname === "/jsonrpc" && req.method === "POST") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "parse error" } }));
        return;
      }
      if (body.method === "agent/get") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              protocolVersion: "1.0",
              name: "mock-remote-agent",
              description: "A mock external A2A agent for verification.",
              url: BASE,
            },
          })
        );
        return;
      }
      if (body.method === "message/send") {
        const text = (body.params?.message?.parts ?? [])
          .map((part) => (typeof part.text === "string" ? part.text : ""))
          .join("");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              id: "remote-msg-1",
              role: "agent",
              kind: "message",
              message: {
                role: "agent",
                kind: "message",
                parts: [{ kind: "text", text: `remote-a2a-reply:${text.slice(0, 80)}` }],
              },
              contextId: "remote-ctx-1",
            },
          })
        );
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "method not found" } }));
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock A2A agent listening on http://127.0.0.1:${PORT}`);
});

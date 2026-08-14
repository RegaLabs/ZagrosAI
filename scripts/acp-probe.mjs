import WebSocket from "ws";

const URL = process.env.PROBE_URL ?? "ws://127.0.0.1:8787/ws/runner";
const TOKEN = process.env.PROBE_TOKEN ?? "rt";

const ws = new WebSocket(URL);
const requestId = `probe-${Date.now()}`;

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "hello", token: TOKEN, name: "probe", os: "linux", arch: "x64", capabilities: { shell: false, filesystem: false, browser: false, docker: false, gpu: false }, models: [], harnesses: [] }));
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === "welcome") {
    console.log("welcome, sending harness.request");
    ws.send(
      JSON.stringify({
        type: "harness.request",
        requestId,
        harness: "testharness",
        method: "prompt",
        params: { sessionKey: "probe-session", system: "sys", user: "hello acp probe" },
      })
    );
  }
  if (msg.type === "harness.event") {
    console.log("EVENT:", msg.delta);
  }
  if (msg.type === "harness.response") {
    console.log("RESPONSE:", msg.ok, msg.error ?? JSON.stringify(msg.result));
    process.exit(0);
  }
});

setTimeout(() => {
  console.error("TIMEOUT - no response");
  process.exit(1);
}, 20000);

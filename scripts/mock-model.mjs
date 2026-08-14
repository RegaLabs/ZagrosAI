import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_MODEL_PORT ?? 9898);
const FLOW = process.env.MOCK_FLOW ?? "shell";
const ECHO_URL = process.env.MOCK_ECHO_URL ?? "http://127.0.0.1:9898/echo";
const PAGE_URL = process.env.MOCK_PAGE_URL ?? "http://127.0.0.1:9899/page";
const REPLY_TEXT = process.env.MOCK_REPLY ?? "Understood, I have nothing durable to add.";
const FAIL_MODE = process.env.MOCK_FLOW === "fail";
const DELEGATE_AGENT = process.env.MOCK_DELEGATE_AGENT ?? "";
const PARALLEL = process.env.MOCK_DELEGATE_PARALLEL === "2";
const A2A_URL = process.env.MOCK_A2A_URL ?? "";
const SECRET_URL = process.env.MOCK_SECRET_URL ?? "";
const DELAY_MS = Number(process.env.MOCK_DELAY_MS ?? 0);

function sse(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function findSessionId(toolMessages) {
  for (const message of [...toolMessages].reverse()) {
    try {
      const parsed = JSON.parse(message.content);
      if (parsed && typeof parsed.id === "string" && typeof parsed.url === "string") return parsed.id;
    } catch {}
  }
  return undefined;
}

function nextBrowserCall(toolMessages) {
  const last = toolMessages[toolMessages.length - 1];
  const name = last.name ?? "";
  const sessionId = findSessionId(toolMessages);
  if (name === "browser.session.create") {
    return {
      id: "call_mock_nav",
      type: "function",
      function: { name: "browser.navigate", arguments: JSON.stringify({ sessionId, url: PAGE_URL }) },
    };
  }
  if (name === "browser.navigate") {
    return {
      id: "call_mock_shot",
      type: "function",
      function: { name: "browser.screenshot", arguments: JSON.stringify({ sessionId }) },
    };
  }
  return null;
}

function memoryExtractionCandidates() {
  return JSON.stringify([
    { content: "the user's favorite color is cyan", kind: "semantic", confidence: 0.95 },
    { content: "the user asked Zagros to remember their favorite color", kind: "episodic", confidence: 0.8 },
  ]);
}

function memoryReply(body) {
  const system = body.messages[0]?.content ?? "";
  const isExtraction = system.includes("memory extractor");
  if (isExtraction) return memoryExtractionCandidates();
  const parts = [];
  if (system.includes("RELEVANT SKILLS")) {
    const m = system.match(/### ([a-z0-9-]+)/);
    if (m) parts.push("skill-loaded:" + m[1]);
  }
  if (system.includes("RELEVANT MEMORY")) {
    const m = system.match(/\[semantic\/[a-z]+\] ([^\n]+)/);
    if (m) parts.push("memory-loaded:" + m[1].slice(0, 60));
  }
  if (parts.length > 0) return parts.join(" | ");
  return REPLY_TEXT;
}

function delegateCalls() {
  const calls = [
    {
      id: "call_del_1",
      type: "function",
      function: { name: "agent.delegate", arguments: JSON.stringify({ agentId: DELEGATE_AGENT, task: "subtask-one: verify the primary number" }) },
    },
  ];
  if (PARALLEL) {
    calls.push({
      id: "call_del_2",
      type: "function",
      function: { name: "agent.delegate", arguments: JSON.stringify({ agentId: DELEGATE_AGENT, task: "subtask-two: verify the secondary number" }) },
    });
  }
  return calls;
}

function flowCalls(toolMessages) {
  const names = toolMessages.map((m) => m.name ?? "");
  if (FLOW === "delegate") {
    if (!names.includes("agent.delegate")) return delegateCalls();
    return null;
  }
  if (FLOW === "guard") {
    if (!names.includes("http.fetch")) {
      return [
        {
          id: "call_guard_1",
          type: "function",
          function: { name: "http.fetch", arguments: JSON.stringify({ url: SECRET_URL }) },
        },
      ];
    }
    return null;
  }
  if (FLOW === "a2a") {
    if (!names.includes("a2a.call")) {
      return [
        {
          id: "call_a2a_1",
          type: "function",
          function: { name: "a2a.call", arguments: JSON.stringify({ url: A2A_URL, message: "ping the remote agent" }) },
        },
      ];
    }
    return null;
  }
  if (FLOW === "artifact") {
    if (!names.includes("artifact.save")) {
      return [
        {
          id: "call_art_1",
          type: "function",
          function: { name: "artifact.save", arguments: JSON.stringify({ key: "build-id", value: "abc123" }) },
        },
      ];
    }
    if (!names.includes("artifact.get")) {
      return [
        {
          id: "call_art_2",
          type: "function",
          function: { name: "artifact.get", arguments: JSON.stringify({ key: "build-id" }) },
        },
      ];
    }
    return null;
  }
  return null;
}

function flowReply(toolMessages) {
  const last = toolMessages[toolMessages.length - 1];
  let parsed = {};
  try {
    parsed = JSON.parse(last.content);
  } catch {}
  if (FLOW === "delegate") {
    const results = toolMessages
      .map((m) => {
        try {
          return String(JSON.parse(m.content)?.result ?? "");
        } catch {
          return "";
        }
      })
      .filter(Boolean);
    return `coordinator-saw:${results.join(" | ").slice(0, 120)}`;
  }
  if (FLOW === "a2a") {
    const reply = parsed?.reply ?? "";
    return `a2a-result:${String(reply).slice(0, 60)}`;
  }
  if (FLOW === "artifact") {
    const value = parsed?.value ?? "";
    return `artifact-flow:${String(value).slice(0, 60)}`;
  }
  if (FLOW === "guard") {
    const content = JSON.stringify(parsed);
    if (content.includes("[REDACTED]")) return "guard:redacted";
    if (content.includes("blocked") || content.includes("policy")) return "guard:blocked";
    return "guard:leaked";
  }
  return REPLY_TEXT;
}

function firstToolCall() {
  if (FLOW === "browser") {
    return {
      id: "call_mock_create",
      type: "function",
      function: {
        name: "browser.session.create",
        arguments: JSON.stringify({}),
      },
    };
  }
  if (FLOW === "post") {
    return {
      id: "call_mock_post",
      type: "function",
      function: {
        name: "http.post",
        arguments: JSON.stringify({ url: ECHO_URL, method: "POST", body: { note: "from-mock-model" } }),
      },
    };
  }
  return {
    id: "call_mock_echo",
    type: "function",
    function: {
      name: "shell.exec",
      arguments: JSON.stringify({ command: "echo hello-from-zagros" }),
    },
  };
}

const server = createServer((req, res) => {
  if (req.method !== "POST" || !req.url.includes("/chat/completions")) {
    res.writeHead(404);
    res.end();
    return;
  }
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  const finishRequest = () => {
    if (FAIL_MODE) {
      res.writeHead(500, { "content-type": "application/json", connection: "close" });
      res.end(JSON.stringify({ error: { message: "mock model failing on purpose" } }));
      return;
    }
    const body = JSON.parse(raw);
    const toolMessages = body.messages.filter((m) => m.role === "tool");
    const lastMessage = body.messages[body.messages.length - 1];
    const isFirstRound = lastMessage?.role === "user";
    let browserCall = null;
    if (FLOW === "browser" && toolMessages.length > 0) {
      browserCall = nextBrowserCall(toolMessages);
    }

    let toolCallResult = null;
    if (toolMessages.length > 0) {
      try {
        const parsed = JSON.parse(toolMessages[toolMessages.length - 1].content);
        toolCallResult = parsed.stdout ?? parsed.error ?? JSON.stringify(parsed).slice(0, 200);
      } catch {
        toolCallResult = String(toolMessages[0].content).slice(0, 200);
      }
    }

    const memoryText = FLOW === "memory" ? memoryReply(body) : null;
    const lastUserIndex = body.messages.map((m) => m.role).lastIndexOf("user");
    const recentTools = body.messages.slice(lastUserIndex + 1).filter((m) => m.role === "tool");
    const flowCallBatch = FLOW === "delegate" || FLOW === "a2a" || FLOW === "artifact" || FLOW === "guard" ? flowCalls(recentTools) : null;
    const flowText = flowCallBatch === null && (FLOW === "delegate" || FLOW === "a2a" || FLOW === "artifact" || FLOW === "guard") ? flowReply(recentTools) : null;
    if (body.stream) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "close",
      });
      if (flowText !== null) {
        res.write(
          sse({
            id: "chatcmpl-mock-flow",
            object: "chat.completion.chunk",
            choices: [{ index: 0, delta: { content: flowText }, finish_reason: null }],
          })
        );
        res.write(sse({ id: "chatcmpl-mock-flow2", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }));
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      if (flowCallBatch !== null) {
        const deltas = flowCallBatch.map((call, index) => ({ index, ...call }));
        res.write(
          sse({
            id: "chatcmpl-mock-1",
            object: "chat.completion.chunk",
            choices: [{ index: 0, delta: { tool_calls: deltas }, finish_reason: null }],
          })
        );
        res.write(
          sse({
            id: "chatcmpl-mock-2",
            object: "chat.completion.chunk",
            choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
          })
        );
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      if (memoryText !== null && !browserCall) {
        res.write(
          sse({
            id: "chatcmpl-mock-mem",
            object: "chat.completion.chunk",
            choices: [{ index: 0, delta: { content: memoryText }, finish_reason: null }],
          })
        );
        res.write(sse({ id: "chatcmpl-mock-mem2", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }));
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      if (isFirstRound || browserCall) {
        const call = browserCall ?? firstToolCall();
        res.write(
          sse({
            id: "chatcmpl-mock-1",
            object: "chat.completion.chunk",
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      ...call,
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          })
        );
        res.write(
          sse({ id: "chatcmpl-mock-2", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })
        );
      } else {
        const text = `Verified on the execution fabric: the command printed "${toolCallResult ?? "nothing"}".`;
        for (let i = 0; i < text.length; i += 24) {
          res.write(
            sse({
              id: "chatcmpl-mock-3",
              object: "chat.completion.chunk",
              choices: [{ index: 0, delta: { content: text.slice(i, i + 24) }, finish_reason: null }],
            })
          );
        }
        res.write(
          sse({ id: "chatcmpl-mock-4", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })
        );
      }
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    res.writeHead(200, { "content-type": "application/json", connection: "close" });
    if (memoryText !== null && !browserCall) {
      res.end(
        JSON.stringify({
          id: "chatcmpl-mock-mem",
          object: "chat.completion",
          choices: [{ index: 0, message: { role: "assistant", content: memoryText }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })
      );
      return;
    }
    if (isFirstRound || browserCall) {
      const call = browserCall ?? firstToolCall();
      res.end(
        JSON.stringify({
          id: "chatcmpl-mock-1",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    ...call,
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })
      );
    } else {
      res.end(
        JSON.stringify({
          id: "chatcmpl-mock-2",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: `Verified on the execution fabric: the command printed "${toolCallResult ?? "nothing"}".`,
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })
      );
    }
  };
  req.on("end", () => {
    if (DELAY_MS > 0) {
      setTimeout(finishRequest, DELAY_MS);
      return;
    }
    finishRequest();
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`mock model listening on http://127.0.0.1:${PORT}`);
});

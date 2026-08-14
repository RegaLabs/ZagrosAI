import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AnthropicDriver } from "./anthropic.js";
import { CloudflareDriver } from "./cloudflare.js";
import { GeminiDriver } from "./gemini.js";
import { OpenAICompatibleDriver } from "./openai-compatible.js";
import { ModelDriverError } from "../types.js";

let server: Server;
let port = 0;
let lastBody: unknown;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      lastBody = JSON.parse(raw || "{}");
      const url = new URL(req.url ?? "", `http://127.0.0.1:${port}`);
      if (url.pathname.endsWith("/messages")) {
        const body = JSON.parse(raw || "{}") as { stream?: boolean };
        if (body.stream) {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.end(
            'data: {"type":"message_start","message":{"id":"m1"}}\n\n' +
              'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello "}}\n\n' +
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"anthropic"}}\n\n' +
              'data: {"type":"content_block_stop","index":0}\n\n' +
              'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n' +
              'data: {"type":"message_stop"}\n\n'
          );
        } else {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              content: [{ type: "text", text: "ok" }],
              stop_reason: "end_turn",
            })
          );
        }
      } else if (url.pathname.includes("streamGenerateContent")) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(
          'data: {"candidates":[{"content":{"parts":[{"text":"hello "}]}}]}\n\n' +
            'data: {"candidates":[{"content":{"parts":[{"text":"gemini"}]}}]}\n\n'
        );
      } else if (url.pathname.includes("generateContent")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: "gemini-static" }] } }] }));
      } else if (url.pathname.includes("/openai/stream-error")) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end('data: {"error":{"message":"rate limit exceeded","code":"rate_limit_exceeded"}}\n\n');
      } else if (url.pathname.includes("/openai/chat/completions")) {
        const body = JSON.parse(raw || "{}") as { stream?: boolean };
        if (body.stream) {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.end(
            'data: {"choices":[{"delta":{"content":"hello "},"finish_reason":null}]}\n\n' +
              'data: {"choices":[{"delta":{"content":"openai"},"finish_reason":"stop"}]}\n\n' +
              "data: [DONE]\n\n"
          );
        } else {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              choices: [{ message: { content: "static openai" }, finish_reason: "stop" }],
            })
          );
        }
      } else if (url.pathname.includes("/cf/chat/completions")) {
        const body = JSON.parse(raw || "{}") as { stream?: boolean };
        if (body.stream) {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.end('data: {"response":"hello cloudflare"}\n\n');
        } else {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ result: { response: "static cf" } }));
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  port = typeof address === "object" && address ? address.port : 0;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("OpenAICompatibleDriver", () => {
  it("streams text and finish_reason correctly", async () => {
    const driver = new OpenAICompatibleDriver({
      driver: "openai",
      model: "gpt-4o",
      baseUrl: `http://127.0.0.1:${port}/openai`,
      apiKey: "test-key",
    });
    let text = "";
    let doneEvent: { finishReason?: string } | undefined;
    for await (const event of driver.stream({
      messages: [{ role: "user", content: "hi" }],
    })) {
      if (event.type === "text") text += event.text;
      if (event.type === "done") doneEvent = event;
    }
    expect(text).toBe("hello openai");
    expect(doneEvent?.finishReason).toBe("stop");
  });

  it("handles SSE error payload during streaming", async () => {
    const driver = new OpenAICompatibleDriver({
      driver: "openai",
      model: "gpt-4o",
      baseUrl: `http://127.0.0.1:${port}/openai/stream-error`,
      apiKey: "test-key",
    });
    await expect(async () => {
      for await (const _ev of driver.stream({ messages: [{ role: "user", content: "hi" }] })) {
        // iterate
      }
    }).rejects.toThrow(ModelDriverError);
  });
});

describe("CloudflareDriver", () => {
  it("streams response content correctly", async () => {
    const driver = new CloudflareDriver({
      driver: "cloudflare",
      model: "@cf/meta/llama-3-8b-instruct",
      baseUrl: `http://127.0.0.1:${port}/cf`,
      apiKey: "test-key",
    });
    let text = "";
    for await (const event of driver.stream({
      messages: [{ role: "user", content: "hi" }],
    })) {
      if (event.type === "text") text += event.text;
    }
    expect(text).toBe("hello cloudflare");
  });
});

describe("AnthropicDriver", () => {
  it("streams text deltas from the Messages API", async () => {
    const driver = new AnthropicDriver({
      driver: "anthropic",
      model: "claude-sonnet-4",
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "test-key",
      temperature: 0.5,
      imageInput: false,
    });
    let text = "";
    for await (const event of driver.stream({
      messages: [
        { role: "system", content: "be brief" },
        { role: "user", content: "hi" },
      ],
    })) {
      if (event.type === "text") text += event.text;
    }
    expect(text).toBe("hello anthropic");
    expect((lastBody as Record<string, unknown>).system).toBe("be brief");
    expect((lastBody as Record<string, unknown>).max_tokens).toBe(1024);
  });

  it("maps tool messages to tool_result blocks", async () => {
    const driver = new AnthropicDriver({
      driver: "anthropic",
      model: "claude-sonnet-4",
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "test-key",
      temperature: 0.5,
      imageInput: false,
    });
    await driver.generate({
      messages: [
        { role: "user", content: "run" },
        { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "shell.exec", arguments: "{}" }] },
        { role: "tool", content: "ok", toolCallId: "t1", name: "shell.exec" },
      ],
    });
    const messages = (lastBody as { messages?: unknown[] }).messages;
    expect((messages?.[1] as { content?: Array<{ type: string }> }).content?.[0]?.type).toBe("tool_use");
    expect((messages?.[2] as { content?: Array<{ type: string }> }).content?.[0]?.type).toBe("tool_result");
  });
});

describe("GeminiDriver", () => {
  it("streams text from streamGenerateContent", async () => {
    const driver = new GeminiDriver({
      driver: "google",
      model: "gemini-2.5-flash",
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: "gk",
      temperature: 0.3,
      imageInput: false,
    });
    let text = "";
    for await (const event of driver.stream({
      messages: [{ role: "system", content: "be brief" }, { role: "user", content: "hi" }],
    })) {
      if (event.type === "text") text += event.text;
    }
    expect(text).toBe("hello gemini");
    const body = lastBody as { contents?: unknown[]; systemInstruction?: { parts: Array<{ text: string }> } };
    expect(body.systemInstruction?.parts?.[0]?.text).toBe("be brief");
    expect(body.contents).toHaveLength(1);
  });

  it("reports no tool calling (function calling arrives later)", async () => {
    const driver = new GeminiDriver({
      driver: "google",
      model: "gemini-2.5-flash",
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: "gk",
      temperature: 0.3,
      imageInput: false,
    });
    const caps = await driver.capabilities();
    expect(caps.toolCalling).toBe(false);
  });
});

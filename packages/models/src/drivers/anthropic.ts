import type { ModelConfig } from "@zagros/domain";
import {
  ModelDriverError,
  type ModelCapabilities,
  type ModelDriver,
  type ModelEvent,
  type ModelMessage,
  type ModelRequest,
  type ModelResponse,
  type ModelToolCall,
} from "../types.js";

const DEFAULT_MAX_TOKENS = 1024;

interface WireBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  source?: { type: string; media_type?: string; data?: string };
  content?: string;
}

interface WireMessage {
  role: string;
  content: WireBlock[] | string;
}

function toBlocks(content: ModelMessage["content"]): WireBlock[] {
  if (typeof content === "string") {
    return content.length > 0 ? [{ type: "text", text: content }] : [];
  }
  const blocks: WireBlock[] = [];
  for (const part of content) {
    if (part.type === "text" && part.text) blocks.push({ type: "text", text: part.text });
    if (part.type === "image" && part.data.startsWith("data:")) {
      const match = /^data:([^;]+);base64,(.+)$/.exec(part.data);
      if (match) {
        blocks.push({ type: "image", source: { type: "base64", media_type: match[1], data: match[2] } });
      }
    }
  }
  return blocks;
}

function convertMessages(messages: ModelMessage[]): { system: string; messages: WireMessage[] } {
  const system: string[] = [];
  const wire: WireMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      if (typeof message.content === "string") system.push(message.content);
      continue;
    }
    if (message.role === "assistant") {
      const blocks: WireBlock[] = toBlocks(message.content);
      for (const call of message.toolCalls ?? []) {
        let input: unknown = {};
        try {
          input = JSON.parse(call.arguments);
        } catch {
          input = { _raw: call.arguments };
        }
        blocks.push({ type: "tool_use", id: call.id, name: call.name, input });
      }
      wire.push({ role: "assistant", content: blocks });
      continue;
    }
    if (message.role === "tool") {
      wire.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.toolCallId ?? "",
            content: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
          },
        ],
      });
      continue;
    }
    wire.push({ role: "user", content: toBlocks(message.content) });
  }
  return { system: system.join("\n\n"), messages: wire };
}

export class AnthropicDriver implements ModelDriver {
  readonly id = "anthropic";
  readonly config: ModelConfig;
  private readonly baseUrl: string;

  constructor(config: ModelConfig) {
    this.config = config;
    this.baseUrl = (config.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/$/, "");
  }

  async capabilities(): Promise<ModelCapabilities> {
    return {
      textInput: true,
      imageInput: this.config.imageInput ?? true,
      audioInput: false,
      videoInput: false,
      toolCalling: true,
      parallelTools: true,
      structuredOutput: true,
      supportsFiles: false,
      maxContext: 200_000,
    };
  }

  private async request(body: unknown, stream: boolean): Promise<Response> {
    if (!this.config.apiKey) {
      throw new ModelDriverError(`${this.id}: missing API key`, this.id);
    }
    const res = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ModelDriverError(
        `${this.id}: ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 500)}` : ""}`,
        this.id,
        res.status
      );
    }
    void stream;
    return res;
  }

  private buildBody(request: ModelRequest, stream: boolean): Record<string, unknown> {
    const { system, messages } = convertMessages(request.messages);
    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: request.temperature ?? this.config.temperature,
      messages,
      stream,
    };
    if (system) body.system = system;
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters ?? { type: "object", properties: {} },
      }));
    }
    return body;
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const res = await this.request(this.buildBody(request, true), true);
    if (!res.body) throw new ModelDriverError(`${this.id}: empty response body`, this.id);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finishReason = "";

    let currentToolCall: { id: string; name: string; argsJson: string } | null = null;

    const processLine = function* (line: string, id: string): Generator<ModelEvent> {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return;
      let event: {
        type?: string;
        error?: { type?: string; message?: string };
        delta?: { type?: string; text?: string; partial_json?: string };
        content_block?: { type: string; id?: string; name?: string };
        message?: { stop_reason?: string };
      };
      try {
        event = JSON.parse(payload);
      } catch {
        return;
      }
      if (event.type === "error" && event.error) {
        throw new ModelDriverError(`${id}: ${event.error.message ?? event.error.type ?? "stream error"}`, id);
      }
      if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
        currentToolCall = {
          id: event.content_block.id ?? "",
          name: event.content_block.name ?? "",
          argsJson: "",
        };
      }
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
        yield { type: "text", text: event.delta.text };
      }
      if (event.type === "content_block_delta" && event.delta?.type === "input_json_delta" && currentToolCall) {
        currentToolCall.argsJson += event.delta.partial_json ?? "";
      }
      if (event.type === "content_block_stop" && currentToolCall) {
        yield {
          type: "tool_call",
          call: {
            id: currentToolCall.id,
            name: currentToolCall.name,
            arguments: currentToolCall.argsJson || "{}",
          },
        };
        currentToolCall = null;
      }
      if (event.type === "message_delta" && event.message?.stop_reason) {
        finishReason = event.message.stop_reason;
      }
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode(undefined, { stream: false });
          if (buffer.trim().length > 0) {
            for (const line of buffer.split("\n")) {
              yield* processLine(line, this.id);
            }
          }
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          yield* processLine(line, this.id);
        }
      }
    } finally {
      reader.releaseLock();
    }

    const mappedReason =
      finishReason === "max_tokens"
        ? "length"
        : finishReason === "tool_use"
          ? "tool_calls"
          : "stop";

    yield { type: "done", finishReason: mappedReason };
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const res = await this.request(this.buildBody(request, false), false);
    const json = (await res.json()) as {
      content?: WireBlock[];
      stop_reason?: string;
      error?: { message?: string };
    };
    if (json.error) {
      throw new ModelDriverError(`${this.id}: ${json.error.message ?? "API error"}`, this.id);
    }
    const text = (json.content ?? [])
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text!)
      .join("");
    const toolCalls: ModelToolCall[] = (json.content ?? [])
      .filter((b) => b.type === "tool_use")
      .map((b) => ({
        id: b.id ?? "",
        name: b.name ?? "",
        arguments: JSON.stringify(b.input ?? {}),
      }));
    return {
      text,
      toolCalls,
      finishReason:
        json.stop_reason === "stop_turn" || json.stop_reason === "end_turn"
          ? "stop"
          : json.stop_reason === "tool_use"
            ? "tool_calls"
            : json.stop_reason === "max_tokens"
              ? "length"
              : "stop",
    };
  }
}

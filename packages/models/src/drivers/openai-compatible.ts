import type { ModelConfig } from "@zagros/domain";
import {
  ModelDriverError,
  type ModelCapabilities,
  type ModelDriver,
  type ModelEvent,
  type ModelMessage,
  type ModelRequest,
  type ModelResponse,
  type ModelTool,
  type ModelToolCall,
} from "../types.js";

interface WireMessage {
  role: string;
  content?: unknown;
  tool_calls?: WireToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface WireChoiceChunk {
  delta: {
    content?: string | null;
    tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
  };
  finish_reason: string | null;
}

function convertMessage(m: ModelMessage): WireMessage {
  const base: WireMessage = { role: m.role };
  if (m.role === "tool") {
    base.tool_call_id = m.toolCallId;
    base.content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    if (m.name) base.name = m.name;
    return base;
  }
  if (typeof m.content === "string") {
    base.content = m.content;
  } else {
    base.content = m.content.map((part) => {
      if (part.type === "text") return { type: "text", text: part.text };
      if (part.type === "image") {
        return { type: "image_url", image_url: { url: part.data } };
      }
      return { type: "input_audio", input_audio: { data: part.data, format: "mp3" } };
    });
  }
  if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
    base.tool_calls = m.toolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.name, arguments: tc.arguments },
    }));
  }
  if (m.name) base.name = m.name;
  return base;
}

function convertTools(tools: ModelTool[]): Array<{ type: "function"; function: unknown }> {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

function parseSseChunk(buffer: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  for (const line of buffer.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") continue;
    try {
      events.push(JSON.parse(payload));
    } catch {
      // ignore malformed keep-alive payloads
    }
  }
  return events;
}

export class OpenAICompatibleDriver implements ModelDriver {
  readonly id: string;
  readonly config: ModelConfig;
  private readonly baseUrl: string;
  private readonly hasImageInput: boolean;

  constructor(config: ModelConfig) {
    this.config = config;
    this.id = config.driver;
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.hasImageInput = config.imageInput ?? true;
  }

  async capabilities(): Promise<ModelCapabilities> {
    return {
      textInput: true,
      imageInput: this.hasImageInput,
      audioInput: false,
      videoInput: false,
      toolCalling: true,
      parallelTools: true,
      structuredOutput: true,
      supportsFiles: false,
    };
  }

  private async request(body: unknown): Promise<Response> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`;
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
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
    return res;
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const body = {
      model: this.config.model,
      messages: request.messages.map(convertMessage),
      tools: request.tools && request.tools.length > 0 ? convertTools(request.tools) : undefined,
      temperature: request.temperature ?? this.config.temperature,
      max_tokens: request.maxTokens,
      stream: true,
    };
    const res = await this.request(body);
    if (!res.body) throw new ModelDriverError(`${this.id}: empty response body`, this.id);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const pendingCalls = new Map<number, { id: string; name: string; args: string }>();
    const finishReasons: string[] = [];

    const processEvents = function* (events: Array<Record<string, unknown>>, id: string): Generator<ModelEvent> {
      for (const event of events) {
        if (event.error && typeof event.error === "object") {
          const errObj = event.error as { message?: string; code?: string | number };
          throw new ModelDriverError(
            `${id}: ${errObj.message ?? JSON.stringify(errObj)}`,
            id
          );
        }
        const choices = event.choices as WireChoiceChunk[] | undefined;
        if (!choices) continue;
        for (const choice of choices) {
          if (choice.finish_reason) finishReasons.push(choice.finish_reason);
          if (choice.delta.content) {
            yield { type: "text", text: choice.delta.content };
          }
          for (let i = 0; i < (choice.delta.tool_calls ?? []).length; i += 1) {
            const tc = choice.delta.tool_calls![i]!;
            const idx = typeof tc.index === "number" ? tc.index : i;
            const existing = pendingCalls.get(idx);
            if (tc.id && !existing) {
              pendingCalls.set(idx, { id: tc.id, name: "", args: "" });
            }
            if (!pendingCalls.has(idx)) {
              pendingCalls.set(idx, { id: tc.id ?? `call_${idx}`, name: "", args: "" });
            }
            const entry = pendingCalls.get(idx)!;
            if (tc.function?.name) entry.name += tc.function.name;
            if (tc.function?.arguments) entry.args += tc.function.arguments;
          }
        }
      }
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode(undefined, { stream: false });
          if (buffer.trim().length > 0) {
            yield* processEvents(parseSseChunk(buffer), this.id);
          }
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        if (!buffer.includes("\n")) continue;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        yield* processEvents(parseSseChunk(lines.join("\n")), this.id);
      }
    } finally {
      reader.releaseLock();
    }

    for (const call of pendingCalls.values()) {
      yield { type: "tool_call", call: { id: call.id, name: call.name, arguments: call.args } };
    }

    const primaryReason = finishReasons[0];
    const mappedReason: "stop" | "tool_calls" | "length" | "error" =
      primaryReason === "stop"
        ? "stop"
        : primaryReason === "tool_calls"
          ? "tool_calls"
          : primaryReason === "length"
            ? "length"
            : pendingCalls.size > 0
              ? "tool_calls"
              : "stop";

    yield { type: "done", finishReason: mappedReason };
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const body = {
      model: this.config.model,
      messages: request.messages.map(convertMessage),
      tools: request.tools && request.tools.length > 0 ? convertTools(request.tools) : undefined,
      temperature: request.temperature ?? this.config.temperature,
      max_tokens: request.maxTokens,
      stream: false,
    };
    const res = await this.request(body);
    const json = (await res.json()) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string | null; tool_calls?: WireToolCall[] }; finish_reason?: string }>;
    };
    if (json.error) {
      throw new ModelDriverError(`${this.id}: ${json.error.message ?? JSON.stringify(json.error)}`, this.id);
    }
    const choice = json.choices?.[0];
    if (!choice) throw new ModelDriverError(`${this.id}: no choices in response`, this.id);

    const toolCalls: ModelToolCall[] = (choice.message?.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function?.name ?? "",
      arguments: tc.function?.arguments ?? "",
    }));
    return {
      text: choice.message?.content ?? "",
      toolCalls,
      finishReason:
        choice.finish_reason === "stop"
          ? "stop"
          : choice.finish_reason === "tool_calls"
            ? "tool_calls"
            : choice.finish_reason === "length"
              ? "length"
              : "error",
    };
  }
}

import type { ModelConfig } from "@zagros/domain";
import { ModelDriverError, type ModelCapabilities, type ModelDriver, type ModelEvent, type ModelRequest, type ModelResponse } from "../types.js";
import { OpenAICompatibleDriver } from "./openai-compatible.js";

export class CloudflareDriver implements ModelDriver {
  readonly id = "cloudflare";
  readonly config: ModelConfig;
  private readonly baseUrl: string;
  private readonly apiToken: string | undefined;

  constructor(config: ModelConfig) {
    this.config = config;
    const key = config.apiKey ?? "";
    const sep = key.indexOf(":");
    if (sep > 0) {
      this.apiToken = key.slice(sep + 1);
      const accountId = key.slice(0, sep);
      this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
    } else {
      this.apiToken = key || undefined;
      this.baseUrl = (config.baseUrl ?? "https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/ai/v1").replace(/\/$/, "");
    }
  }

  async capabilities(): Promise<ModelCapabilities> {
    return {
      textInput: true,
      imageInput: this.config.imageInput ?? true,
      audioInput: false,
      videoInput: false,
      toolCalling: false,
      parallelTools: false,
      structuredOutput: false,
      supportsFiles: false,
    };
  }

  private async chat(body: unknown): Promise<Response> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiToken) headers.authorization = `Bearer ${this.apiToken}`;
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
    const res = await this.chat({
      model: this.config.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
      temperature: request.temperature ?? this.config.temperature,
      stream: true,
    });
    if (!res.body) throw new ModelDriverError(`${this.id}: empty response body`, this.id);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const processLine = (line: string): ModelEvent | undefined => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return undefined;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return undefined;
      try {
        const event = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
          response?: string;
          errors?: Array<{ message?: string }>;
        };
        if (event.errors && event.errors.length > 0) {
          throw new ModelDriverError(`${this.id}: ${event.errors[0]?.message ?? "API error"}`, this.id);
        }
        const content = event.choices?.[0]?.delta?.content ?? event.response;
        if (content) return { type: "text", text: content };
      } catch (err) {
        if (err instanceof ModelDriverError) throw err;
      }
      return undefined;
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode(undefined, { stream: false });
          if (buffer.trim().length > 0) {
            for (const line of buffer.split("\n")) {
              const ev = processLine(line);
              if (ev) yield ev;
            }
          }
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const ev = processLine(line);
          if (ev) yield ev;
        }
      }
    } finally {
      reader.releaseLock();
    }
    yield { type: "done", finishReason: "stop" };
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const res = await this.chat({
      model: this.config.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
      temperature: request.temperature ?? this.config.temperature,
      stream: false,
    });
    const json = (await res.json()) as {
      result?: { response?: string };
      choices?: Array<{ message?: { content?: string } }>;
      errors?: Array<{ message?: string }>;
    };
    if (json.errors && json.errors.length > 0) {
      throw new ModelDriverError(`${this.id}: ${json.errors[0]?.message ?? "API error"}`, this.id);
    }
    const text = json.choices?.[0]?.message?.content ?? json.result?.response ?? "";
    return { text, toolCalls: [], finishReason: "stop" };
  }
}

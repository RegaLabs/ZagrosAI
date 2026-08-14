import type { ModelConfig } from "@zagros/domain";
import { ModelDriverError, type ModelCapabilities, type ModelDriver, type ModelEvent, type ModelMessage, type ModelRequest, type ModelResponse } from "../types.js";

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
}

interface GeminiContent {
  role?: "user" | "model";
  parts: GeminiPart[];
}

function toParts(content: ModelMessage["content"]): GeminiPart[] {
  if (typeof content === "string") {
    return content.length > 0 ? [{ text: content }] : [];
  }
  const parts: GeminiPart[] = [];
  for (const part of content) {
    if (part.type === "text" && part.text) parts.push({ text: part.text });
    if (part.type === "image" && part.data.startsWith("data:")) {
      const match = /^data:([^;]+);base64,(.+)$/.exec(part.data);
      if (match) {
        parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
      }
    }
  }
  return parts;
}

function convertContents(messages: ModelMessage[]): { system: string; contents: GeminiContent[] } {
  const systemParts: string[] = [];
  const contents: GeminiContent[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      if (typeof message.content === "string") systemParts.push(message.content);
      continue;
    }
    if (message.role === "assistant") {
      contents.push({ role: "model", parts: toParts(message.content) });
      continue;
    }
    if (message.role === "tool") {
      contents.push({
        role: "user",
        parts: [{ text: typeof message.content === "string" ? message.content : JSON.stringify(message.content) }],
      });
      continue;
    }
    contents.push({ role: "user", parts: toParts(message.content) });
  }
  return { system: systemParts.join("\n\n"), contents };
}

export class GeminiDriver implements ModelDriver {
  readonly id = "google";
  readonly config: ModelConfig;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: ModelConfig) {
    this.config = config;
    this.baseUrl = (config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
    this.apiKey = config.apiKey ?? "";
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

  private url(stream: boolean): string {
    const path = stream ? ":streamGenerateContent?alt=sse" : ":generateContent";
    const keyParam = this.apiKey ? `&key=${encodeURIComponent(this.apiKey)}` : "";
    return `${this.baseUrl}/models/${encodeURIComponent(this.config.model)}${path}${keyParam}`;
  }

  private buildBody(request: ModelRequest): Record<string, unknown> {
    const { system, contents } = convertContents(request.messages);
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: request.temperature ?? this.config.temperature,
        maxOutputTokens: request.maxTokens ?? 1024,
      },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    return body;
  }

  private async request(body: unknown, stream: boolean): Promise<Response> {
    const res = await fetch(this.url(stream), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ModelDriverError(`${this.id}: ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 500)}` : ""}`, this.id, res.status);
    }
    return res;
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const res = await this.request(this.buildBody(request), true);
    if (!res.body) throw new ModelDriverError(`${this.id}: empty response body`, this.id);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finishReason = "stop";

    const processLine = function* (line: string, id: string): Generator<ModelEvent> {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return;
      let event: {
        error?: { message?: string };
        candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
      };
      try {
        event = JSON.parse(payload);
      } catch {
        return;
      }
      if (event.error) {
        throw new ModelDriverError(`${id}: ${event.error.message ?? "API error"}`, id);
      }
      const candidate = event.candidates?.[0];
      if (candidate?.finishReason) {
        finishReason = candidate.finishReason;
      }
      for (const part of candidate?.content?.parts ?? []) {
        if (part.text) yield { type: "text", text: part.text };
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
    const mappedReason: "stop" | "tool_calls" | "length" | "error" =
      finishReason === "MAX_TOKENS"
        ? "length"
        : finishReason === "SAFETY" || finishReason === "RECITATION"
          ? "error"
          : "stop";

    yield { type: "done", finishReason: mappedReason };
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const res = await this.request(this.buildBody(request), false);
    const json = (await res.json()) as {
      error?: { message?: string };
      candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
    };
    if (json.error) {
      throw new ModelDriverError(`${this.id}: ${json.error.message ?? "API error"}`, this.id);
    }
    const candidate = json.candidates?.[0];
    const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    const finishReason =
      candidate?.finishReason === "MAX_TOKENS"
        ? "length"
        : candidate?.finishReason === "SAFETY" || candidate?.finishReason === "RECITATION"
          ? "error"
          : "stop";
    return { text, toolCalls: [], finishReason };
  }
}

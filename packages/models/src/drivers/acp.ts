import type { ModelConfig } from "@zagros/domain";
import type { ModelCapabilities, ModelDriver, ModelEvent, ModelRequest, ModelResponse } from "../types.js";

export interface AcpPromptEvent {
  type: "text";
  text: string;
}

export interface AcpTransport {
  streamPrompt(opts: {
    harness: string;
    sessionKey: string;
    system: string;
    user: string;
  }): AsyncIterable<AcpPromptEvent>;
}

export class AcpDriver implements ModelDriver {
  readonly id = "acp";
  readonly config: ModelConfig;
  private readonly transport: AcpTransport;

  constructor(config: ModelConfig, transport: AcpTransport) {
    this.config = config;
    this.transport = transport;
  }

  async capabilities(): Promise<ModelCapabilities> {
    return {
      textInput: true,
      imageInput: false,
      audioInput: false,
      videoInput: false,
      toolCalling: false,
      parallelTools: false,
      structuredOutput: false,
      supportsFiles: false,
      harnessManagedTools: true,
    };
  }

  private extract(request: ModelRequest): { system: string; user: string } {
    let system = "";
    let user = "";
    for (const message of request.messages) {
      if (message.role === "system" && typeof message.content === "string") {
        system = message.content;
        continue;
      }
      if (message.role === "user") {
        if (typeof message.content === "string") {
          user = message.content;
        } else {
          user = message.content
            .filter((part) => part.type === "text")
            .map((part) => (part as { text: string }).text)
            .join("\n");
        }
      }
    }
    return { system, user };
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const harness = this.config.harness;
    if (!harness) throw new Error("acp driver requires a harness name (e.g. codex, claude-code, gemini-cli)");
    const { system, user } = this.extract(request);
    if (!user) {
      yield { type: "done" };
      return;
    }
    for await (const event of this.transport.streamPrompt({
      harness,
      sessionKey: request.sessionKey ?? "default",
      system,
      user,
    })) {
      yield { type: "text", text: event.text };
    }
    yield { type: "done" };
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    let text = "";
    for await (const event of this.stream(request)) {
      if (event.type === "text") text += event.text;
    }
    return { text, toolCalls: [], finishReason: "stop" };
  }
}

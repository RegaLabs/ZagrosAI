import type { ModelConfig } from "@zagros/domain";

export interface ModelCapabilities {
  textInput: boolean;
  imageInput: boolean;
  audioInput: boolean;
  videoInput: boolean;
  toolCalling: boolean;
  parallelTools: boolean;
  structuredOutput: boolean;
  maxContext?: number;
  reasoningControls?: string[];
  supportsFiles: boolean;
  harnessManagedTools?: boolean;
}

export interface ModelTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type ModelContentPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType?: string }
  | { type: "audio"; data: string; mimeType?: string };

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ModelContentPart[];
  name?: string;
  toolCallId?: string;
  toolCalls?: ModelToolCall[];
}

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type ModelEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; call: ModelToolCall }
  | { type: "done"; finishReason?: "stop" | "tool_calls" | "length" | "error" };

export interface ModelRequest {
  messages: ModelMessage[];
  tools?: ModelTool[];
  temperature?: number;
  maxTokens?: number;
  sessionKey?: string;
}

export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface ModelResponse {
  text: string;
  toolCalls: ModelToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | "error";
  usage?: ModelUsage;
}

export interface ModelDriver {
  readonly id: string;
  readonly config: ModelConfig;
  capabilities(): Promise<ModelCapabilities>;
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
  generate(request: ModelRequest): Promise<ModelResponse>;
}

export class ModelDriverError extends Error {
  constructor(
    message: string,
    readonly driverId: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "ModelDriverError";
  }
}

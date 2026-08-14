import type { ModelConfig } from "@zagros/domain";
import type { ModelCapabilities, ModelDriver, ModelEvent, ModelRequest, ModelResponse, ModelToolCall } from "../types.js";

export interface FakeDriverStep {
  reply?: string;
  toolCall?: ModelToolCall;
  toolCalls?: ModelToolCall[];
}

export class FakeModelDriver implements ModelDriver {
  readonly id: string;
  readonly config: ModelConfig;
  private steps: FakeDriverStep[] = [];
  private stepIndex = 0;

  constructor(config: { driver: string; model: string } & Partial<ModelConfig>, steps?: FakeDriverStep[]) {
    this.id = config.driver;
    this.config = { temperature: 0.7, imageInput: true, ...config } as ModelConfig;
    if (steps) this.steps = steps;
  }

  setSteps(steps: FakeDriverStep[]): void {
    this.steps = steps;
    this.stepIndex = 0;
  }

  reset(): void {
    this.stepIndex = 0;
  }

  async capabilities(): Promise<ModelCapabilities> {
    return {
      textInput: true,
      imageInput: true,
      audioInput: false,
      videoInput: false,
      toolCalling: true,
      parallelTools: true,
      structuredOutput: true,
      supportsFiles: false,
    };
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const step = this.steps[this.stepIndex] ?? { reply: "No further output." };
    if (this.stepIndex < this.steps.length) this.stepIndex += 1;
    if (step.reply) {
      for (const word of step.reply.split(" ")) {
        yield { type: "text", text: word + " " };
      }
    }
    if (step.toolCall) {
      yield { type: "tool_call", call: step.toolCall };
    }
    if (step.toolCalls) {
      for (const call of step.toolCalls) {
        yield { type: "tool_call", call };
      }
    }
    yield { type: "done" };
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const step = this.steps[this.stepIndex] ?? { reply: "No further output." };
    if (this.stepIndex < this.steps.length) this.stepIndex += 1;
    const calls = step.toolCalls ?? (step.toolCall ? [step.toolCall] : []);
    return {
      text: step.reply ?? "",
      toolCalls: calls,
      finishReason: calls.length > 0 ? "tool_calls" : "stop",
    };
  }
}

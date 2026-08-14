import type { ModelConfig } from "@zagros/domain";
import type { ModelCapabilities, ModelDriver } from "../types.js";
import { OpenAICompatibleDriver } from "./openai-compatible.js";

export class OllamaDriver extends OpenAICompatibleDriver {
  constructor(config: ModelConfig) {
    super({ ...config, driver: "ollama" });
  }

  override async capabilities(): Promise<ModelCapabilities> {
    const base = await super.capabilities();
    return { ...base, toolCalling: true };
  }
}

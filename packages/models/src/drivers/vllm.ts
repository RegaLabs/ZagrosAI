import type { ModelConfig } from "@zagros/domain";
import type { ModelCapabilities } from "../types.js";
import { OpenAICompatibleDriver } from "./openai-compatible.js";

export class VLLMDriver extends OpenAICompatibleDriver {
  constructor(config: ModelConfig) {
    super({
      ...config,
      driver: "vllm",
      baseUrl: config.baseUrl ?? "http://localhost:8000/v1",
    });
  }

  override async capabilities(): Promise<ModelCapabilities> {
    const base = await super.capabilities();
    return {
      ...base,
      maxContext: 65536,
      supportsFiles: false,
    };
  }
}

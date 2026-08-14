import type { ModelConfig } from "@zagros/domain";
import type { ModelCapabilities } from "../types.js";
import { OpenAICompatibleDriver } from "./openai-compatible.js";

export class OpenRouterDriver extends OpenAICompatibleDriver {
  constructor(config: ModelConfig) {
    super({
      ...config,
      driver: "openrouter",
      baseUrl: config.baseUrl ?? "https://openrouter.ai/api/v1",
    });
  }

  override async capabilities(): Promise<ModelCapabilities> {
    const base = await super.capabilities();
    return {
      ...base,
      maxContext: 200000,
      supportsFiles: true,
    };
  }
}

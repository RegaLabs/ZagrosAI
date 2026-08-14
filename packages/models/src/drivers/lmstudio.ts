import type { ModelConfig } from "@zagros/domain";
import type { ModelCapabilities } from "../types.js";
import { OpenAICompatibleDriver } from "./openai-compatible.js";

export class LMStudioDriver extends OpenAICompatibleDriver {
  constructor(config: ModelConfig) {
    super({
      ...config,
      driver: "lmstudio",
      baseUrl: config.baseUrl ?? "http://localhost:1234/v1",
    });
  }

  override async capabilities(): Promise<ModelCapabilities> {
    const base = await super.capabilities();
    return {
      ...base,
      maxContext: 32768,
      supportsFiles: false,
    };
  }
}

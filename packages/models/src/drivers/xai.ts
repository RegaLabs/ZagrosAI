import type { ModelConfig } from "@zagros/domain";
import type { ModelCapabilities } from "../types.js";
import { OpenAICompatibleDriver } from "./openai-compatible.js";

export class XAIDriver extends OpenAICompatibleDriver {
  constructor(config: ModelConfig) {
    super({
      ...config,
      driver: "xai",
      baseUrl: config.baseUrl ?? "https://api.x.ai/v1",
    });
  }

  override async capabilities(): Promise<ModelCapabilities> {
    const base = await super.capabilities();
    return {
      ...base,
      maxContext: 131072,
      reasoningControls: ["thinking"],
      supportsFiles: true,
    };
  }
}

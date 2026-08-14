import type { ModelConfig } from "@zagros/domain";
import type { ModelCapabilities } from "../types.js";
import { OpenAICompatibleDriver } from "./openai-compatible.js";

export class OpenAIDriver extends OpenAICompatibleDriver {
  constructor(config: ModelConfig) {
    super({
      ...config,
      driver: "openai",
      baseUrl: config.baseUrl ?? "https://api.openai.com/v1",
    });
  }

  override async capabilities(): Promise<ModelCapabilities> {
    const base = await super.capabilities();
    return {
      ...base,
      maxContext: 128000,
      reasoningControls: ["reasoning_effort"],
      supportsFiles: true,
    };
  }
}

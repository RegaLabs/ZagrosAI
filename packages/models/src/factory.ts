import type { ModelConfig } from "@zagros/domain";
import type { ModelDriver } from "./types.js";
import { AcpDriver, type AcpTransport } from "./drivers/acp.js";
import { AnthropicDriver } from "./drivers/anthropic.js";
import { CloudflareDriver } from "./drivers/cloudflare.js";
import { GeminiDriver } from "./drivers/gemini.js";
import { LMStudioDriver } from "./drivers/lmstudio.js";
import { OllamaDriver } from "./drivers/ollama.js";
import { OpenAIDriver } from "./drivers/openai.js";
import { OpenAICompatibleDriver } from "./drivers/openai-compatible.js";
import { OpenRouterDriver } from "./drivers/openrouter.js";
import { VLLMDriver } from "./drivers/vllm.js";
import { XAIDriver } from "./drivers/xai.js";
import { FakeModelDriver } from "./drivers/fake.js";

export interface CreateDriverOptions {
  acpTransport?: AcpTransport;
}

export function createDriver(config: ModelConfig, options?: CreateDriverOptions): ModelDriver {
  switch (config.driver) {
    case "acp":
      if (!options?.acpTransport) {
        throw new Error("acp driver requires an AcpTransport (provided by the Zagros kernel)");
      }
      return new AcpDriver(config, options.acpTransport);
    case "anthropic":
      return new AnthropicDriver(config);
    case "google":
      return new GeminiDriver(config);
    case "cloudflare":
      return new CloudflareDriver(config);
    case "ollama":
      return new OllamaDriver(config);
    case "openai":
      return new OpenAIDriver(config);
    case "xai":
      return new XAIDriver(config);
    case "openrouter":
      return new OpenRouterDriver(config);
    case "vllm":
      return new VLLMDriver(config);
    case "lmstudio":
      return new LMStudioDriver(config);
    case "openai-compatible":
      return new OpenAICompatibleDriver(config);
    default:
      return new OpenAICompatibleDriver(config);
  }
}


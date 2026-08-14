import type { ModelCapabilities, ModelDriver, ModelMessage, ModelRequest } from "./types.js";

export interface CapabilityNegotiationResult {
  compatible: boolean;
  missing: string[];
  capabilities: ModelCapabilities;
  adaptedRequest?: ModelRequest;
}

export async function negotiateCapabilities(
  driver: ModelDriver,
  requirements: Partial<ModelCapabilities>
): Promise<CapabilityNegotiationResult> {
  const caps = await driver.capabilities();
  const missing: string[] = [];

  for (const [key, required] of Object.entries(requirements)) {
    if (required === true) {
      const capKey = key as keyof ModelCapabilities;
      if (!caps[capKey]) {
        missing.push(key);
      }
    }
  }

  if (requirements.maxContext && caps.maxContext) {
    if (caps.maxContext < requirements.maxContext) {
      missing.push(`maxContext (${caps.maxContext} < required ${requirements.maxContext})`);
    }
  }

  return {
    compatible: missing.length === 0,
    missing,
    capabilities: caps,
  };
}

export function adaptRequestForCapabilities(
  capabilities: ModelCapabilities,
  request: ModelRequest
): ModelRequest {
  let messages = request.messages;

  if (!capabilities.imageInput) {
    messages = messages.map((msg) => {
      if (typeof msg.content === "string") return msg;
      const textParts: string[] = [];
      for (const part of msg.content) {
        if (part.type === "text") {
          textParts.push(part.text);
        } else if (part.type === "image") {
          textParts.push("[Image omitted: driver does not support image input]");
        }
      }
      return { ...msg, content: textParts.join("\n") };
    });
  }

  let tools = request.tools;
  if (!capabilities.toolCalling && tools && tools.length > 0) {
    tools = undefined;
  }

  return {
    ...request,
    messages,
    tools,
  };
}

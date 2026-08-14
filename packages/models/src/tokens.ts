import type { ModelCapabilities, ModelMessage, ModelRequest, ModelTool } from "./types.js";

export interface TokenNegotiationOptions {
  fallbackMaxContext?: number;
  safetyMarginTokens?: number;
  preserveSystemPrompt?: boolean;
}

export function estimateContentTokens(content: string | ModelMessage["content"]): number {
  if (typeof content === "string") {
    // Approx ~4 characters per token heuristic
    return Math.ceil(content.length / 4);
  }
  let total = 0;
  for (const part of content) {
    if (part.type === "text") {
      total += Math.ceil(part.text.length / 4);
    } else if (part.type === "image") {
      total += 500; // Standard image token estimate
    } else if (part.type === "audio") {
      total += 300;
    }
  }
  return total;
}

export function estimateTokenCount(messages: ModelMessage[], tools?: ModelTool[]): number {
  let count = 0;
  for (const msg of messages) {
    count += 4; // overhead per message
    count += estimateContentTokens(msg.content);
    if (msg.name) count += Math.ceil(msg.name.length / 4);
    if (msg.toolCalls) {
      for (const call of msg.toolCalls) {
        count += Math.ceil(call.name.length / 4) + Math.ceil(call.arguments.length / 4);
      }
    }
  }
  if (tools) {
    for (const t of tools) {
      count += Math.ceil(t.name.length / 4) + Math.ceil(t.description.length / 4);
      count += Math.ceil(JSON.stringify(t.parameters).length / 4);
    }
  }
  return count;
}

export function negotiateTokenLimits(
  capabilities: ModelCapabilities,
  request: ModelRequest,
  options?: TokenNegotiationOptions
): ModelRequest {
  const maxContext = capabilities.maxContext ?? options?.fallbackMaxContext ?? 128000;
  const safetyMargin = options?.safetyMarginTokens ?? 500;
  const preserveSystem = options?.preserveSystemPrompt ?? true;

  const currentPromptTokens = estimateTokenCount(request.messages, request.tools);
  let requestedMaxTokens = request.maxTokens ?? 2048;

  const availableForPrompt = maxContext - requestedMaxTokens - safetyMargin;

  let messages = [...request.messages];

  // If prompt exceeds available window, truncate message history (keeping system prompt)
  if (currentPromptTokens > availableForPrompt && messages.length > 1) {
    const systemMessages: ModelMessage[] = [];
    const nonSystemMessages: ModelMessage[] = [];

    for (const msg of messages) {
      if (preserveSystem && msg.role === "system") {
        systemMessages.push(msg);
      } else {
        nonSystemMessages.push(msg);
      }
    }

    while (nonSystemMessages.length > 1) {
      nonSystemMessages.shift(); // remove oldest conversation turn
      const newPromptTokens = estimateTokenCount([...systemMessages, ...nonSystemMessages], request.tools);
      if (newPromptTokens <= availableForPrompt) {
        break;
      }
    }

    messages = [...systemMessages, ...nonSystemMessages];
  }

  // Recalculate prompt tokens and adjust maxTokens if necessary
  const finalPromptTokens = estimateTokenCount(messages, request.tools);
  const remainingBudget = maxContext - finalPromptTokens - safetyMargin;

  if (remainingBudget <= 0) {
    throw new Error(`Token limit negotiation failed: Prompt tokens (${finalPromptTokens}) exceed model maxContext (${maxContext})`);
  }

  if (requestedMaxTokens > remainingBudget) {
    requestedMaxTokens = Math.max(100, remainingBudget);
  }

  return {
    ...request,
    messages,
    maxTokens: requestedMaxTokens,
  };
}

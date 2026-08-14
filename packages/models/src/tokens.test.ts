import { describe, expect, it } from "vitest";
import { estimateTokenCount, negotiateTokenLimits } from "./tokens.js";

describe("Token Limit Negotiation", () => {
  it("estimates token counts for messages", () => {
    const messages = [
      { role: "system" as const, content: "You are a helpful assistant." },
      { role: "user" as const, content: "Hello world!" },
    ];
    const count = estimateTokenCount(messages);
    expect(count).toBeGreaterThan(5);
  });

  it("truncates long prompt history to fit within maxContext", () => {
    const systemMsg = { role: "system" as const, content: "System prompt" };
    const longMsg1 = { role: "user" as const, content: "A".repeat(4000) };
    const longMsg2 = { role: "assistant" as const, content: "B".repeat(4000) };
    const recentMsg = { role: "user" as const, content: "Hi" };

    const caps = {
      textInput: true,
      imageInput: true,
      audioInput: false,
      videoInput: false,
      toolCalling: true,
      parallelTools: false,
      structuredOutput: false,
      maxContext: 2000,
      supportsFiles: false,
    };

    const req = {
      messages: [systemMsg, longMsg1, longMsg2, recentMsg],
      maxTokens: 500,
    };

    const negotiated = negotiateTokenLimits(caps, req, { safetyMarginTokens: 100 });

    expect(negotiated.messages.length).toBeLessThan(4);
    expect(negotiated.messages[0]).toEqual(systemMsg); // system prompt preserved
    expect(negotiated.messages[negotiated.messages.length - 1]).toEqual(recentMsg);
  });
});

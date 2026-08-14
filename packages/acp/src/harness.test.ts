import { describe, expect, it } from "vitest";
import { detectSubscriptionHarnesses, inspectHarnessLoginState } from "./harness.js";

describe("Subscription Harness Detection & Native Login Inspection", () => {
  it("inspects harness login state preserving native auth boundaries", async () => {
    const codexState = await inspectHarnessLoginState("codex");
    expect(codexState.harness).toBe("codex");
    expect(codexState.authBoundary).toBe("native");

    const claudeState = await inspectHarnessLoginState("claude-code");
    expect(claudeState.harness).toBe("claude-code");
    expect(claudeState.authBoundary).toBe("native");

    const geminiState = await inspectHarnessLoginState("gemini-cli");
    expect(geminiState.harness).toBe("gemini-cli");
    expect(geminiState.authBoundary).toBe("native");
  });

  it("detects available subscription harnesses on local machine", async () => {
    const detected = await detectSubscriptionHarnesses();
    expect(detected.length).toBeGreaterThanOrEqual(3);
    const names = detected.map((d) => d.name);
    expect(names).toContain("codex");
    expect(names).toContain("claude-code");
    expect(names).toContain("gemini-cli");
  });
});

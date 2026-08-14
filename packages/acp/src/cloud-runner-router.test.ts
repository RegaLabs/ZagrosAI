import { describe, expect, it, vi } from "vitest";
import { CloudVsRunnerRouter } from "./cloud-runner-router.js";
import * as harnessModule from "./harness.js";

describe("Cloud-vs-Runner Model Availability Router", () => {
  it("routes to cloud when cloud_only strategy is requested", async () => {
    const router = new CloudVsRunnerRouter();
    const decision = await router.route({
      model: "gpt-4o",
      provider: "openai",
      hasCloudApiKey: true,
      strategy: "cloud_only",
    });
    expect(decision.target).toBe("cloud");
  });

  it("routes to runner harness when subscription_only strategy is requested and harness is logged in", async () => {
    vi.spyOn(harnessModule, "inspectHarnessLoginState").mockResolvedValue({
      harness: "codex",
      installed: true,
      loggedIn: true,
      account: "user@example.com",
      subscriptionType: "chatgpt_plan",
      authBoundary: "native",
    });

    const router = new CloudVsRunnerRouter();
    const decision = await router.route({
      model: "gpt-4o",
      provider: "openai",
      strategy: "subscription_only",
    });

    expect(decision.target).toBe("runner");
    expect(decision.harnessName).toBe("codex");
  });

  it("falls back from subscription to cloud API key if harness is not logged in", async () => {
    vi.spyOn(harnessModule, "inspectHarnessLoginState").mockResolvedValue({
      harness: "claude-code",
      installed: false,
      loggedIn: false,
      authBoundary: "native",
    });

    const router = new CloudVsRunnerRouter("prefer_subscription");
    const decision = await router.route({
      model: "claude-3-5-sonnet",
      provider: "anthropic",
      hasCloudApiKey: true,
    });

    expect(decision.target).toBe("cloud");
  });
});

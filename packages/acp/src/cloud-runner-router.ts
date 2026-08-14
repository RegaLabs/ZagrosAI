import { inspectHarnessLoginState, type HarnessLoginState } from "./harness.js";

export type RoutingStrategy =
  | "prefer_subscription"
  | "prefer_cloud"
  | "subscription_only"
  | "cloud_only"
  | "fallback_cloud_to_runner"
  | "fallback_runner_to_cloud";

export interface CloudVsRunnerRouteRequest {
  model: string;
  provider: string; // e.g. "openai", "anthropic", "google"
  harnessName?: string; // e.g. "codex", "claude-code", "gemini-cli"
  hasCloudApiKey?: boolean;
  strategy?: RoutingStrategy;
}

export interface CloudVsRunnerDecision {
  target: "cloud" | "runner";
  harnessName?: string;
  harnessLoginState?: HarnessLoginState;
  reason: string;
}

export class CloudVsRunnerRouter {
  constructor(private readonly defaultStrategy: RoutingStrategy = "prefer_subscription") {}

  async route(request: CloudVsRunnerRouteRequest): Promise<CloudVsRunnerDecision> {
    const strategy = request.strategy ?? this.defaultStrategy;
    const harnessName = request.harnessName ?? this.mapProviderToHarness(request.provider);

    const loginState = harnessName ? await inspectHarnessLoginState(harnessName) : undefined;
    const isHarnessAvailable = loginState ? loginState.installed && loginState.loggedIn : false;
    const hasCloudKey = request.hasCloudApiKey ?? false;

    if (strategy === "cloud_only") {
      if (!hasCloudKey) {
        throw new Error(`Cloud-only strategy specified for model '${request.model}', but no cloud API key is available.`);
      }
      return { target: "cloud", reason: "Strategy cloud_only selected with direct API key." };
    }

    if (strategy === "subscription_only") {
      if (!isHarnessAvailable) {
        throw new Error(
          `Subscription-only strategy specified for model '${request.model}', but subscription harness '${harnessName}' is not logged in or installed.`
        );
      }
      return {
        target: "runner",
        harnessName,
        harnessLoginState: loginState,
        reason: `Strategy subscription_only selected with active harness ${harnessName} (${loginState?.subscriptionType}).`,
      };
    }

    if (strategy === "prefer_subscription") {
      if (isHarnessAvailable) {
        return {
          target: "runner",
          harnessName,
          harnessLoginState: loginState,
          reason: `Preferring subscription harness ${harnessName} over cloud API key.`,
        };
      }
      if (hasCloudKey) {
        return { target: "cloud", reason: `Subscription harness not available; falling back to direct cloud API key.` };
      }
      throw new Error(`Neither subscription harness '${harnessName}' nor cloud API key is available for model '${request.model}'.`);
    }

    if (strategy === "prefer_cloud" || strategy === "fallback_cloud_to_runner") {
      if (hasCloudKey) {
        return { target: "cloud", reason: "Direct cloud API key available and preferred." };
      }
      if (isHarnessAvailable) {
        return {
          target: "runner",
          harnessName,
          harnessLoginState: loginState,
          reason: "Cloud API key missing; falling back to logged-in subscription harness.",
        };
      }
      throw new Error(`Neither cloud API key nor subscription harness '${harnessName}' is available for model '${request.model}'.`);
    }

    // fallback_runner_to_cloud
    if (isHarnessAvailable) {
      return {
        target: "runner",
        harnessName,
        harnessLoginState: loginState,
        reason: `Runner subscription harness ${harnessName} available.`,
      };
    }
    if (hasCloudKey) {
      return { target: "cloud", reason: "Subscription harness unavailable; using cloud API key fallback." };
    }

    throw new Error(`No available routing path for model '${request.model}'.`);
  }

  private mapProviderToHarness(provider: string): string {
    const p = provider.toLowerCase();
    if (p === "openai") return "codex";
    if (p === "anthropic") return "claude-code";
    if (p === "google" || p === "gemini") return "gemini-cli";
    return provider;
  }
}

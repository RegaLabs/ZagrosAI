import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

export interface HarnessLoginState {
  harness: string;
  installed: boolean;
  loggedIn: boolean;
  account?: string;
  subscriptionType?: "chatgpt_plan" | "google_oauth" | "subscription" | "api_key" | "free" | "unknown";
  authBoundary: "native";
  details?: string;
}

export interface DetectedHarness {
  name: string;
  installed: boolean;
  commandPath?: string;
  loginState: HarnessLoginState;
}

function checkCommandPath(cmd: string): string | undefined {
  try {
    const isWin = process.platform === "win32";
    const checkCmd = isWin ? `where ${cmd}` : `command -v ${cmd}`;
    const output = execSync(checkCmd, { stdio: ["pipe", "pipe", "ignore"], encoding: "utf8" });
    const firstLine = output.trim().split(/\r?\n/)[0];
    return firstLine || undefined;
  } catch {
    return undefined;
  }
}

export async function inspectHarnessLoginState(harnessName: string): Promise<HarnessLoginState> {
  const name = harnessName.toLowerCase();
  const home = os.homedir();

  if (name === "codex") {
    const installed = !!checkCommandPath("codex");
    const codexConfigDir = path.join(home, ".codex");
    const authFile = path.join(codexConfigDir, "auth.json");
    const configFile = path.join(codexConfigDir, "config.json");
    const hasEnvKey = !!process.env.CODEX_API_KEY || !!process.env.OPENAI_API_KEY;

    let loggedIn = false;
    let account: string | undefined;
    let subscriptionType: HarnessLoginState["subscriptionType"] = "unknown";

    if (fs.existsSync(authFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(authFile, "utf8"));
        if (data.tokens || data.session_token || data.chatgpt_plan || data.user_email) {
          loggedIn = true;
          account = data.user_email || data.username || "chatgpt-user";
          subscriptionType = data.chatgpt_plan ? "chatgpt_plan" : "subscription";
        }
      } catch {
        // malformed json fallback
      }
    }

    if (!loggedIn && fs.existsSync(configFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(configFile, "utf8"));
        if (data.loggedIn || data.authenticated) {
          loggedIn = true;
          account = data.email || "codex-user";
          subscriptionType = "chatgpt_plan";
        }
      } catch {
        // fallback
      }
    }

    if (!loggedIn && hasEnvKey) {
      loggedIn = true;
      subscriptionType = "api_key";
    }

    return {
      harness: "codex",
      installed,
      loggedIn,
      account,
      subscriptionType: loggedIn ? (subscriptionType ?? "chatgpt_plan") : undefined,
      authBoundary: "native",
      details: installed ? (loggedIn ? "Codex native ChatGPT-plan authentication active" : "Codex installed but not logged in") : "Codex CLI not found",
    };
  }

  if (name === "claude" || name === "claude-code") {
    const installed = !!checkCommandPath("claude");
    const claudeConfigFile = path.join(home, ".claude.json");
    const claudeDir = path.join(home, ".claude");
    const hasEnvKey = !!process.env.CLAUDE_CODE_TOKEN || !!process.env.ANTHROPIC_API_KEY;

    let loggedIn = false;
    let account: string | undefined;
    let subscriptionType: HarnessLoginState["subscriptionType"] = "unknown";

    if (fs.existsSync(claudeConfigFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(claudeConfigFile, "utf8"));
        if (data.sessionKey || data.oauthToken || data.account) {
          loggedIn = true;
          account = data.account?.email || data.user || "claude-user";
          subscriptionType = "subscription";
        }
      } catch {
        // fallback
      }
    }

    if (!loggedIn && fs.existsSync(claudeDir)) {
      loggedIn = true;
      subscriptionType = "subscription";
    }

    if (!loggedIn && hasEnvKey) {
      loggedIn = true;
      subscriptionType = "api_key";
    }

    return {
      harness: "claude-code",
      installed,
      loggedIn,
      account,
      subscriptionType: loggedIn ? (subscriptionType ?? "subscription") : undefined,
      authBoundary: "native",
      details: installed ? (loggedIn ? "Claude Code subscription-backed native authentication active" : "Claude Code installed but not logged in") : "Claude Code CLI not found",
    };
  }

  if (name === "gemini" || name === "gemini-cli") {
    const installed = !!checkCommandPath("gemini");
    const geminiDir = path.join(home, ".config", "gemini");
    const gcloudDir = path.join(home, ".config", "gcloud");
    const hasEnvKey = !!process.env.GEMINI_API_KEY || !!process.env.GOOGLE_APPLICATION_CREDENTIALS;

    let loggedIn = false;
    let account: string | undefined;
    let subscriptionType: HarnessLoginState["subscriptionType"] = "unknown";

    if (fs.existsSync(geminiDir) || fs.existsSync(gcloudDir)) {
      loggedIn = true;
      subscriptionType = "google_oauth";
      account = "google-oauth-user";
    }

    if (!loggedIn && hasEnvKey) {
      loggedIn = true;
      subscriptionType = "api_key";
    }

    return {
      harness: "gemini-cli",
      installed,
      loggedIn,
      account,
      subscriptionType: loggedIn ? (subscriptionType ?? "google_oauth") : undefined,
      authBoundary: "native",
      details: installed ? (loggedIn ? "Gemini CLI Google OAuth native authentication active" : "Gemini CLI installed but not logged in") : "Gemini CLI not found",
    };
  }

  // Generic harness
  const cmdPath = checkCommandPath(harnessName);
  const installed = !!cmdPath;
  return {
    harness: harnessName,
    installed,
    loggedIn: installed,
    authBoundary: "native",
    details: installed ? `Generic harness '${harnessName}' available` : `Generic harness '${harnessName}' not found`,
  };
}

export async function detectSubscriptionHarnesses(): Promise<DetectedHarness[]> {
  const harnessesToTest = ["codex", "claude-code", "gemini-cli"];
  const results: DetectedHarness[] = [];

  for (const name of harnessesToTest) {
    const loginState = await inspectHarnessLoginState(name);
    const cmdPath = checkCommandPath(name.split("-")[0]!);
    results.push({
      name,
      installed: loginState.installed,
      commandPath: cmdPath,
      loginState,
    });
  }

  return results;
}

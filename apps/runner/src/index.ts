#!/usr/bin/env node
import { hostname } from "node:os";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import WebSocket from "ws";
import { serverToRunnerSchema, type RunnerHello, type RunnerMessage, type ServerToRunner } from "@zagros/protocol";
import { createFileTools, createShellTool, ToolRegistry } from "@zagros/tools";
import { BrowserManager } from "./browser.js";
import { AcpHarnessHost, type HarnessCommand } from "./acp.js";
import { createBrowserTools, createFilesListTool } from "./runner-tools.js";

export const TOOL_TIMEOUT_MS = 180_000;
export const INITIAL_RETRY_MS = 1_000;
export const MAX_RETRY_MS = 30_000;

export interface CliOptions {
  url: string;
  token: string;
  name: string;
  workspace: string;
  cwd: string;
  noBrowser: boolean;
}

export const DEFAULT_HARNESS_COMMANDS: Array<{ name: string; command: string; args: string[] }> = [
  { name: "codex", command: "codex", args: ["acp"] },
  { name: "claude-code", command: "claude", args: ["--acp"] },
  { name: "gemini-cli", command: "gemini-cli", args: ["acp"] },
];

export async function detectHarnesses(env: NodeJS.ProcessEnv): Promise<HarnessCommand[]> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const found: HarnessCommand[] = [];
  for (const candidate of DEFAULT_HARNESS_COMMANDS) {
    const override = env[`ZAGROS_HARNESS_CMD_${candidate.name.toUpperCase().replace(/-/g, "_")}`];
    if (override) {
      const parts = override.split(",").map((p) => p.trim()).filter(Boolean);
      if (parts.length > 0) {
        found.push({ name: candidate.name, command: parts[0]!, args: parts.slice(1) });
        continue;
      }
    }
    try {
      await execFileAsync("which", [candidate.command]);
      found.push(candidate);
    } catch {
      // binary not present — skip
    }
  }
  for (const key of Object.keys(env)) {
    if (!key.startsWith("ZAGROS_HARNESS_CMD_")) continue;
    const name = key.slice("ZAGROS_HARNESS_CMD_".length).toLowerCase().replace(/_/g, "-");
    if (found.some((h) => h.name === name)) continue;
    const parts = (env[key] ?? "").split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) {
      found.push({ name, command: parts[0]!, args: parts.slice(1) });
    }
  }
  return found;
}

export function log(message: string): void {
  const now = new Date();
  const stamp = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  console.log(`[zagros-runner ${stamp}] ${message}`);
}

export function usage(): string {
  return [
    "Usage: zagros-runner start --url wss://host/ws/runner --token SECRET [--name laptop] [--workspace /path] [--cwd /path]",
    "",
    "Flags:",
    "  --url        WebSocket endpoint of the Zagros server (required, ws:// or wss://)",
    "  --token      Pairing token (required, non-empty)",
    "  --name       Worker name (default: hostname)",
    "  --workspace  Filesystem root for the runner (default: ./workspace)",
    "  --cwd        Base directory for the default workspace (default: current directory)",
    "  --no-browser Disable the Playwright browser capability (shell and files stay enabled)",
  ].join("\n");
}

export function parseArgs(argv: string[]): CliOptions | undefined {
  if (argv[0] !== "start") return undefined;
  const options: CliOptions = {
    url: "",
    token: "",
    name: hostname(),
    workspace: "",
    cwd: process.cwd(),
    noBrowser: false,
  };
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--url":
        if (value === undefined) return undefined;
        options.url = value.trim();
        i++;
        break;
      case "--token":
        if (value === undefined) return undefined;
        options.token = value.trim();
        i++;
        break;
      case "--name":
        if (value === undefined) return undefined;
        options.name = value.trim();
        i++;
        break;
      case "--workspace":
        if (value === undefined) return undefined;
        options.workspace = value.trim();
        i++;
        break;
      case "--cwd":
        if (value === undefined) return undefined;
        options.cwd = value.trim();
        i++;
        break;
      case "--no-browser":
        options.noBrowser = true;
        break;
      default:
        return undefined;
    }
  }

  if (!options.url || !options.token) return undefined;

  // Validate WebSocket URL scheme
  try {
    const parsedUrl = new URL(options.url);
    if (parsedUrl.protocol !== "ws:" && parsedUrl.protocol !== "wss:") {
      return undefined;
    }
  } catch {
    return undefined;
  }

  return options;
}

export function run(options: CliOptions, workspaceDir: string): void {
  const registry = new ToolRegistry();
  registry.register(createShellTool(workspaceDir, process.env.ZAGROS_SHELL_WRAPPER));
  registry.registerMany(createFileTools(workspaceDir));
  registry.register(createFilesListTool(workspaceDir));
  const browser = options.noBrowser
    ? undefined
    : new BrowserManager(
        resolve(options.cwd, ".zagros-browser-profiles"),
        process.env.ZAGROS_BROWSER_CHANNEL ?? "chrome"
      );
  if (browser) {
    registry.registerMany(createBrowserTools(browser));
  }
  let acpHost!: AcpHarnessHost;
  void detectHarnesses(process.env).then((harnesses) => {
    acpHost = new AcpHarnessHost(harnesses);
    if (harnesses.length > 0) {
      log(`ACP harnesses available: ${harnesses.map((h) => h.name).join(", ")}`);
    }
    connect();
  });

  let ws: WebSocket | undefined;
  let retryDelayMs = INITIAL_RETRY_MS;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let shuttingDown = false;
  const inFlightRequests = new Map<string, AbortController>();

  const send = (message: RunnerMessage): void => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  };

  const handleToolRequest = async (message: Extract<ServerToRunner, { type: "tool.request" }>): Promise<void> => {
    const { requestId, toolId, args } = message;
    let responded = false;
    const respond = (ok: boolean, result?: unknown, error?: string): void => {
      if (responded) return;
      responded = true;
      send({
        type: "tool.response",
        requestId,
        ok,
        ...(ok ? { result } : { error }),
      });
    };

    if (!registry.get(toolId)) {
      respond(false, undefined, `Unknown tool: ${toolId}`);
      return;
    }

    const controller = new AbortController();
    inFlightRequests.set(requestId, controller);

    const timer = setTimeout(() => {
      controller.abort();
      respond(false, undefined, `Tool execution timed out after ${TOOL_TIMEOUT_MS / 1000}s`);
    }, TOOL_TIMEOUT_MS);

    try {
      const result = await registry.execute(toolId, args, {
        cwd: workspaceDir,
        requestId,
        signal: controller.signal,
      });
      if (result.ok) {
        respond(true, result.data);
      } else {
        respond(false, undefined, result.error);
      }
    } catch (err) {
      respond(false, undefined, err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
      inFlightRequests.delete(requestId);
    }
  };

  const handleHarnessRequest = async (message: Extract<ServerToRunner, { type: "harness.request" }>): Promise<void> => {
    const { requestId, harness, method, params } = message;
    let responded = false;
    const respond = (ok: boolean, result?: unknown, error?: string): void => {
      if (responded) return;
      responded = true;
      send({ type: "harness.response", requestId, ok, ...(ok ? { result } : { error }) });
    };
    try {
      log(`Harness request: ${harness} ${method} (${params.sessionKey ?? "default"})`);
      switch (method) {
        case "session_new": {
          await acpHost.prompt(harness, params.sessionKey ?? "default", params.system ?? "", "");
          respond(true, { ok: true });
          break;
        }
        case "close": {
          await acpHost.close(harness);
          respond(true, { ok: true });
          break;
        }
        case "prompt": {
          for await (const delta of acpHost.prompt(harness, params.sessionKey ?? "default", params.system ?? "", params.user ?? "")) {
            if (!responded) send({ type: "harness.event", requestId, delta });
          }
          respond(true, { ok: true });
          break;
        }
      }
    } catch (err) {
      respond(false, undefined, err instanceof Error ? err.message : String(err));
    }
  };

  const handleMessage = (raw: WebSocket.RawData): void => {
    let parsed: ServerToRunner;
    try {
      parsed = serverToRunnerSchema.parse(JSON.parse(raw.toString()));
    } catch (err) {
      log(`Invalid message from server: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    switch (parsed.type) {
      case "welcome":
        log(`Connected to Zagros server ${parsed.serverId} as worker ${parsed.workerId}`);
        retryDelayMs = INITIAL_RETRY_MS;
        break;
      case "ping":
        send({ type: "pong" });
        break;
      case "tool.request":
        void handleToolRequest(parsed);
        break;
      case "harness.request":
        void handleHarnessRequest(parsed);
        break;
    }
  };

  const connect = (): void => {
    if (shuttingDown) return;
    if (ws) {
      try {
        ws.removeAllListeners();
        ws.close();
      } catch {}
      ws = undefined;
    }
    log(`Connecting to ${options.url}...`);
    ws = new WebSocket(options.url);
    ws.on("open", () => {
      const hello: RunnerHello = {
        type: "hello",
        token: options.token,
        name: options.name,
        os: process.platform,
        arch: process.arch,
        capabilities: { shell: true, filesystem: true, browser: !options.noBrowser, docker: false, gpu: false },
        models: [],
        harnesses: acpHost.names(),
      };
      send(hello);
      log(`Hello sent as ${options.name} (${process.platform}/${process.arch})`);
    });
    ws.on("message", handleMessage);
    ws.on("error", (err) => {
      log(`Socket error: ${err.message}`);
    });
    ws.on("close", (code, reason) => {
      const text = reason.toString();
      log(`Connection closed (${code}${text ? `: ${text}` : ""})`);
      ws = undefined;
      if (shuttingDown) return;

      // Handle invalid runner token (code 4001) as fatal auth error
      if (code === 4001 || text.includes("invalid runner token")) {
        log(`Authentication failed: invalid runner token (code ${code}). Check your --token option.`);
        void shutdown("AUTH_FAILED", 1);
        return;
      }

      if (reconnectTimer) clearTimeout(reconnectTimer);
      const jittered = Math.round(retryDelayMs * (0.75 + Math.random() * 0.5));
      log(`Reconnecting in ${(jittered / 1000).toFixed(1)}s...`);
      reconnectTimer = setTimeout(() => connect(), jittered);
      retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_MS);
    });
  };

  const shutdown = async (signal: string, exitCode = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`Received ${signal}, shutting down...`);
    if (reconnectTimer) clearTimeout(reconnectTimer);

    // Abort all in-flight requests immediately
    for (const controller of inFlightRequests.values()) {
      controller.abort();
    }
    inFlightRequests.clear();

    if (ws) {
      try {
        ws.removeAllListeners();
        if (ws.readyState !== WebSocket.CLOSED) {
          ws.close(1000, "runner shutting down");
        }
      } catch {}
      ws = undefined;
    }
    try {
      await Promise.all([
        acpHost?.closeAll().catch((err) => log(`Error closing ACP harness: ${err}`)),
        browser?.closeAll().catch((err) => log(`Error closing browser manager: ${err}`)),
      ]);
    } catch {}
    log("Cleanup complete, exiting.");
    process.exit(exitCode);
  };

  process.on("SIGINT", () => void shutdown("SIGINT", 0));
  process.on("SIGTERM", () => void shutdown("SIGTERM", 0));
  process.on("SIGHUP", () => void shutdown("SIGHUP", 0));
}

function main(): void {
  const args = process.argv.slice(2);
  if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    console.log(usage());
    process.exit(0);
  }
  const options = parseArgs(args);
  if (!options) {
    console.error("Error: Invalid or missing arguments.\n");
    console.error(usage());
    process.exit(1);
  }
  const workspaceDir = options.workspace === "" ? resolve(options.cwd, "workspace") : options.workspace;
  mkdirSync(workspaceDir, { recursive: true });
  run(options, workspaceDir);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  main();
}


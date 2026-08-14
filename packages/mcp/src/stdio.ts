import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { scrubSensitiveText } from "@zagros/credentials";
import type { McpCallResult, McpClient, McpToolInfo } from "./types.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface McpStdioOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  connectTimeoutMs?: number;
  scrubSecrets?: (text: string) => string;
}

export class McpStdioClient implements McpClient {
  private child: ChildProcess | undefined;
  private readline: Interface | undefined;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private closed = false;
  private ready: Promise<void> | undefined;
  private readonly timeoutMs: number;
  private readonly connectTimeoutMs: number;

  constructor(private readonly options: McpStdioOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  }

  async connect(): Promise<void> {
    if (this.closed) throw new Error("MCP client is closed");
    if (this.child && this.child.exitCode === null && this.child.signalCode === null && this.ready !== undefined) {
      return this.ready;
    }
    this.ready = this.doConnect();
    try {
      await this.ready;
    } catch (err) {
      this.ready = undefined;
      this.child = undefined;
      throw err;
    }
  }

  private async doConnect(): Promise<void> {
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) return;
    
    // Clean up any stale process state
    this.cleanupChild();

    const child = spawn(this.options.command, this.options.args ?? [], {
      cwd: this.options.cwd,
      env: this.options.env ? { ...process.env, ...this.options.env } : process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;

    const stderr = child.stderr;
    if (stderr) {
      stderr.on("data", (chunk: Buffer) => {
        const raw = chunk.toString();
        const scrubber = this.options.scrubSecrets ?? scrubSensitiveText;
        const scrubbed = scrubber(raw);
        console.error("[mcp:stdio] " + scrubbed);
      });
    }

    const stdout = child.stdout;
    if (!stdout) {
      child.kill("SIGTERM");
      throw new Error("MCP server produced no stdout stream");
    }

    child.on("error", (err) => {
      this.failPending(new Error(`MCP server process error: ${err.message}`));
      this.child = undefined;
      this.ready = undefined;
    });

    child.on("exit", (code, signal) => {
      this.failPending(
        new Error(`MCP server exited (code=${code ?? "null"}, signal=${signal ?? "null"})`)
      );
      this.cleanupChild();
    });

    const rl = createInterface({ input: stdout, crlfDelay: Infinity });
    this.readline = rl;
    rl.on("line", (line) => this.handleLine(line));

    const result = await this.requestWithTimeout("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "zagros", version: "1.0.0" },
    }, this.connectTimeoutMs);
    this.validateInitialize(result);
    this.notify("notifications/initialized");
  }

  async listTools(): Promise<McpToolInfo[]> {
    await this.ensureConnected();
    const result = await this.request("tools/list", {});
    if (typeof result !== "object" || result === null) {
      throw new Error("MCP tools/list: invalid response");
    }
    const tools = (result as Record<string, unknown>).tools;
    if (!Array.isArray(tools)) {
      throw new Error("MCP tools/list: missing tools array");
    }
    return tools.map((t) => {
      const tool = t as Record<string, unknown>;
      return {
        name: typeof tool.name === "string" ? tool.name : "",
        description: typeof tool.description === "string" ? tool.description : "",
        inputSchema:
          typeof tool.inputSchema === "object" && tool.inputSchema !== null
            ? (tool.inputSchema as Record<string, unknown>)
            : {},
      };
    });
  }

  async callTool(name: string, args: unknown): Promise<McpCallResult> {
    await this.ensureConnected();
    const result = await this.request("tools/call", { name, arguments: args });
    if (typeof result !== "object" || result === null) {
      throw new Error("MCP tools/call: invalid response");
    }
    const record = result as Record<string, unknown>;
    const content = Array.isArray(record.content) ? record.content : [];
    const parts: string[] = [];
    for (const item of content) {
      if (typeof item !== "object" || item === null) continue;
      const entry = item as Record<string, unknown>;
      if (entry.type === "text" && typeof entry.text === "string") {
        parts.push(entry.text);
      } else {
        parts.push(JSON.stringify(item));
      }
    }
    const isError = record.isError === true;
    return { ok: !isError, text: parts.join("\n"), isError };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.failPending(new Error("MCP client closed"));
    const child = this.child;
    this.cleanupChild();
    if (!child) return;
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
        }
      }, 2000);
      timer.unref();
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        if (!child.kill("SIGTERM")) {
          clearTimeout(timer);
          resolve();
        }
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.closed) throw new Error("MCP client is closed");
    if (!this.child || this.child.exitCode !== null || this.child.signalCode !== null) {
      this.ready = undefined;
      await this.connect();
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    return this.requestWithTimeout(method, params, this.timeoutMs);
  }

  private requestWithTimeout(method: string, params: unknown, timeout: number): Promise<unknown> {
    const child = this.child;
    if (!child || this.closed) {
      return Promise.reject(new Error("MCP client is not connected"));
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      return Promise.reject(new Error("MCP server process is not running"));
    }
    const id = this.nextId++;
    const payload: Record<string, unknown> = { jsonrpc: "2.0", id, method, params: params ?? {} };
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out after ${timeout / 1000}s: ${method}`));
      }, timeout);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try {
        child.stdin?.write(JSON.stringify(payload) + "\n");
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private notify(method: string): void {
    const child = this.child;
    if (!child || this.closed || child.exitCode !== null) return;
    try {
      child.stdin?.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
    } catch {
    }
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: unknown;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (typeof msg !== "object" || msg === null) return;
    const record = msg as Record<string, unknown>;
    const id = typeof record.id === "number" ? record.id : Number(record.id);
    if (isNaN(id)) return;
    const req = this.pending.get(id);
    if (!req) return;
    this.pending.delete(id);
    clearTimeout(req.timer);
    if (record.error !== undefined && record.error !== null) {
      req.reject(new Error(this.errorMessage(record.error)));
    } else {
      req.resolve(record.result);
    }
  }

  private validateInitialize(result: unknown): void {
    if (typeof result !== "object" || result === null) {
      throw new Error("MCP initialize failed: invalid result");
    }
    const record = result as Record<string, unknown>;
    if (typeof record.protocolVersion !== "string") {
      throw new Error("MCP initialize failed: missing protocolVersion");
    }
    if (typeof record.capabilities !== "object" || record.capabilities === null) {
      throw new Error("MCP initialize failed: missing capabilities");
    }
    if (typeof record.serverInfo !== "object" || record.serverInfo === null) {
      throw new Error("MCP initialize failed: missing serverInfo");
    }
  }

  private failPending(err: Error): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const req of pending) {
      clearTimeout(req.timer);
      req.reject(err);
    }
  }

  private cleanupChild(): void {
    if (this.readline) {
      try {
        this.readline.close();
      } catch {
      }
      this.readline = undefined;
    }
    this.child = undefined;
    this.ready = undefined;
  }

  private errorMessage(error: unknown): string {
    if (typeof error === "string") return error;
    if (typeof error === "object" && error !== null) {
      const record = error as Record<string, unknown>;
      const code = typeof record.code === "number" ? `[code ${record.code}] ` : "";
      const msg = typeof record.message === "string" ? record.message : JSON.stringify(error);
      const data = record.data !== undefined ? ` (data: ${JSON.stringify(record.data)})` : "";
      return `${code}${msg}${data}`;
    }
    return JSON.stringify(error);
  }
}

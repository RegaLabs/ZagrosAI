export interface AcpOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface AcpItemUpdate {
  jsonrpc?: string;
  method?: string;
  params?: {
    sessionId?: string;
    messageId?: string;
    type?: string;
    item?: {
      type?: string;
      text?: string;
      content?: Array<{ type?: string; text?: string }>;
      tool?: { name?: string };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const REQUEST_TIMEOUT_MS = 600_000;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class AcpClient {
  private child: import("node:child_process").ChildProcess | undefined;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private closed = false;
  private ready: Promise<void> | undefined;
  private readonly updateListeners = new Set<(update: AcpItemUpdate) => void>();

  constructor(private readonly options: AcpOptions) {}

  onUpdate(listener: (update: AcpItemUpdate) => void): () => void {
    this.updateListeners.add(listener);
    return () => this.updateListeners.delete(listener);
  }

  async connect(): Promise<void> {
    if (this.ready !== undefined) return this.ready;
    this.ready = this.doConnect();
    try {
      await this.ready;
    } catch (err) {
      this.ready = undefined;
      throw err;
    }
  }

  private async doConnect(): Promise<void> {
    if (this.child) return;
    const { spawn } = await import("node:child_process");
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
        console.error(`[acp:${this.options.command}] ${chunk.toString()}`);
      });
    }
    const stdout = child.stdout;
    if (!stdout) {
      child.kill("SIGTERM");
      throw new Error("ACP harness produced no stdout stream");
    }
    child.on("error", (err) => this.failPending(err));
    child.on("exit", (code, signal) => {
      this.failPending(new Error(`ACP harness exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"})`));
    });
    const { createInterface } = await import("node:readline");
    const rl = createInterface({ input: stdout, crlfDelay: Infinity });
    rl.on("line", (line) => this.handleLine(line));

    const result = await this.request("initialize", {
      protocolVersion: "0.2.0",
      clientCapabilities: {},
      agentCapabilities: {},
    });
    this.validateInitialize(result);
  }

  async sessionNew(systemPrompt?: string): Promise<{ sessionId: string }> {
    await this.connect();
    const result = await this.request("session/new", {
      ...(systemPrompt ? { systemPrompt } : {}),
    });
    if (typeof result !== "object" || result === null) throw new Error("ACP session/new: invalid response");
    const sessionId = (result as Record<string, unknown>).sessionId;
    if (typeof sessionId !== "string" || !sessionId) throw new Error("ACP session/new: missing sessionId");
    return { sessionId };
  }

  async sessionResume(sessionId: string): Promise<{ sessionId: string }> {
    await this.connect();
    const result = await this.request("session/resume", { sessionId });
    if (typeof result !== "object" || result === null) throw new Error("ACP session/resume: invalid response");
    return { sessionId };
  }

  async sessionClose(sessionId: string): Promise<void> {
    await this.connect().catch(() => undefined);
    try {
      await this.request("session/close", { sessionId });
    } catch {
      // best effort
    }
  }

  async prompt(sessionId: string, userText: string): Promise<{ messageId: string }> {
    await this.connect();
    const result = await this.request("session/prompt", {
      sessionId,
      message: [{ role: "user", content: [{ type: "text", text: userText }] }],
    });
    if (typeof result !== "object" || result === null) throw new Error("ACP session/prompt: invalid response");
    const messageId = (result as Record<string, unknown>).messageId;
    if (typeof messageId !== "string" || !messageId) throw new Error("ACP session/prompt: missing messageId");
    return { messageId };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.failPending(new Error("ACP client closed"));
    const child = this.child;
    this.child = undefined;
    if (!child) return;
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // already dead
        }
      }, 2000);
      const unref = (timer as { unref?: () => void }).unref;
      if (unref) unref.call(timer);
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

  private request(method: string, params: unknown): Promise<unknown> {
    const child = this.child;
    if (!child || this.closed) {
      return Promise.reject(new Error("ACP client is not connected"));
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      return Promise.reject(new Error("ACP harness process is not running"));
    }
    const id = this.nextId++;
    const payload: Record<string, unknown> = { jsonrpc: "2.0", id, method, params: params ?? {} };
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACP request timed out after ${REQUEST_TIMEOUT_MS / 1000}s: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      const unref = (timer as { unref?: () => void }).unref;
      if (unref) unref.call(timer);
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
    if (record.method === "session/update" || record.method === "session/update_complete" || record.method === "session/created") {
      for (const listener of this.updateListeners) {
        try {
          listener(record as unknown as AcpItemUpdate);
        } catch {
          // listener errors must not break the stream
        }
      }
      return;
    }
    if (typeof record.id !== "number") return;
    const req = this.pending.get(record.id);
    if (!req) return;
    this.pending.delete(record.id);
    clearTimeout(req.timer);
    if (record.error !== undefined) {
      req.reject(new Error(this.errorMessage(record.error)));
    } else {
      req.resolve(record.result);
    }
  }

  private validateInitialize(result: unknown): void {
    if (typeof result !== "object" || result === null) {
      throw new Error("ACP initialize failed: invalid result");
    }
    const record = result as Record<string, unknown>;
    if (typeof record.protocolVersion !== "string") {
      throw new Error("ACP initialize failed: missing protocolVersion");
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

  private errorMessage(error: unknown): string {
    if (typeof error === "string") return error;
    if (typeof error === "object" && error !== null) {
      const record = error as Record<string, unknown>;
      if (typeof record.message === "string") return record.message;
    }
    return JSON.stringify(error);
  }
}

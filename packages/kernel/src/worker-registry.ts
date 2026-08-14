import { newId, now, type Worker, type WorkerCapabilities } from "@zagros/domain";
import { runnerMessageSchema, type ServerToRunner, type RunnerHello } from "@zagros/protocol";
import type { ToolContext, ToolDefinition, ToolResult } from "@zagros/tools";
import type { Repos } from "@zagros/runtime";
import type { AcpTransport, AcpPromptEvent } from "@zagros/models";
import type { LocalEventBus } from "./events.js";
import type { RunnerSocket } from "./types.js";

interface ConnectedRunner {
  worker: Worker;
  socket: RunnerSocket;
}

const TOOL_CAPABILITY: Record<string, keyof WorkerCapabilities> = {
  "shell.exec": "shell",
  "files.read": "filesystem",
  "files.write": "filesystem",
  "files.list": "filesystem",
  "browser.session.create": "browser",
  "browser.session.list": "browser",
  "browser.session.close": "browser",
  "browser.navigate": "browser",
  "browser.screenshot": "browser",
  "browser.text": "browser",
  "browser.click": "browser",
  "browser.type": "browser",
  "browser.evaluate": "browser",
};

const RUNNER_TOOL_TIMEOUT_MS = 120_000;

export class WorkerRegistry {
  private readonly connected = new Map<string, ConnectedRunner>();
  private readonly pending = new Map<string, { resolve: (r: ToolResult) => void }>();
  private readonly pendingPrompts = new Map<
    string,
    { queue: Array<string | undefined>; waiters: Array<(item: string | undefined) => void>; done: boolean; error?: string }
  >();
  private pendingPromptCount = 0;

  constructor(
    private readonly repos: Repos,
    private readonly events: LocalEventBus,
    private readonly runnerToken: () => string
  ) {}

  async list(): Promise<Worker[]> {
    const workers = await this.repos.listWorkers();
    return workers.map((w) => ({
      ...w,
      online: this.connected.has(w.id),
    }));
  }

  getRunnerToolDefinition(toolId: string, description: string, risk: "R0" | "R1" | "R2" | "R3", schema: Record<string, unknown>): ToolDefinition {
    const capability = TOOL_CAPABILITY[toolId];
    return {
      id: toolId,
      provider: "runner",
      description,
      schema,
      risk,
      idempotent: false,
      execute: async (args: unknown, ctx: ToolContext): Promise<ToolResult> => {
        const target = this.pickWorker(capability);
        if (!target) {
          return {
            ok: false,
            error:
              'No Zagros Runner is online with the "' + capability + '" capability. Start one: zagros-runner start --url <server>/ws/runner --name my-computer --token <token>',
          };
        }
        return this.invokeRunnerTool(target, toolId, args, ctx);
      },
    };
  }

  async handleRunnerConnection(socket: RunnerSocket, hello: RunnerHello): Promise<Worker | undefined> {
    if (hello.token !== this.runnerToken()) {
      socket.close(4001, "invalid runner token");
      return undefined;
    }
    const knownWorkers = await this.repos.listWorkers();
    const existing = knownWorkers.find((w) => w.name === hello.name && w.os === hello.os && w.arch === hello.arch);
    const workerId = existing?.id ?? newId("worker");
    const worker: Worker = {
      id: workerId,
      name: hello.name,
      os: hello.os,
      arch: hello.arch,
      capabilities: hello.capabilities,
      models: hello.models,
      harnesses: hello.harnesses,
      online: true,
      connectedAt: now(),
      lastSeenAt: now(),
    };
    await this.repos.saveWorker(worker);
    this.connected.set(workerId, { worker, socket });
    socket.onMessage((data) => this.handleRunnerMessage(workerId, data));
    socket.onClose(() => void this.handleRunnerClose(workerId));

    const welcome: ServerToRunner = {
      type: "welcome",
      serverId: newId("srv"),
      workerId,
      intervalMs: 15000,
    };
    socket.send(JSON.stringify(welcome));
    this.events.emit({ type: "worker.online", worker });
    await this.repos.appendAudit({
      id: newId("audit"),
      type: "worker.online",
      detail: { name: worker.name },
      createdAt: now(),
    });
    return worker;
  }

  private handleRunnerMessage(workerId: string, data: string): void {
    const entry = this.connected.get(workerId);
    if (!entry) return;
    try {
      const parsed = runnerMessageSchema.safeParse(JSON.parse(data));
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.type === "pong") {
        entry.worker.lastSeenAt = now();
        return;
      }
      if (message.type === "tool.response" && "requestId" in message && message.requestId) {
        const pending = this.pending.get(message.requestId);
        if (pending) {
          this.pending.delete(message.requestId);
          pending.resolve({
            ok: message.ok === true,
            data: message.ok === true ? message.result : undefined,
            error: message.ok === false ? (message.error ?? "runner reported failure") : undefined,
            workerId,
          });
        }
      }
      if (message.type === "harness.event" && "requestId" in message && message.requestId) {
        const promptEntry = this.pendingPrompts.get(message.requestId);
        if (promptEntry && !promptEntry.done) {
          this.pushPromptDelta(promptEntry, message.delta);
        }
      }
      if (message.type === "harness.response" && "requestId" in message && message.requestId) {
        const promptEntry = this.pendingPrompts.get(message.requestId);
        if (promptEntry) {
          promptEntry.done = true;
          if (message.ok === false) promptEntry.error = message.error ?? "harness failed";
          this.pushPromptDelta(promptEntry, undefined);
          this.pendingPrompts.delete(message.requestId);
        }
      }
    } catch {
      // ignore malformed runner messages
    }
  }

  private async handleRunnerClose(workerId: string): Promise<void> {
    const entry = this.connected.get(workerId);
    if (!entry) return;
    this.connected.delete(workerId);
    const worker: Worker = { ...entry.worker, online: false };
    await this.repos.saveWorker(worker);
    this.events.emit({ type: "worker.offline", worker });
    await this.repos.appendAudit({
      id: newId("audit"),
      type: "worker.offline",
      detail: { name: worker.name },
      createdAt: now(),
    });
    for (const [requestId, pending] of this.pending) {
      pending.resolve({ ok: false, error: `Runner ${worker.name} went offline before responding.` });
      this.pending.delete(requestId);
    }
    for (const [requestId, promptEntry] of this.pendingPrompts) {
      promptEntry.done = true;
      promptEntry.error = `Runner ${worker.name} went offline during prompt stream.`;
      this.pushPromptDelta(promptEntry, undefined);
      this.pendingPrompts.delete(requestId);
    }
  }

  getHarnessTransport(): AcpTransport {
    return {
      streamPrompt: (opts) => this.streamHarnessPrompt(opts),
    };
  }

  private pushPromptDelta(entry: { queue: Array<string | undefined>; waiters: Array<(item: string | undefined) => void>; done: boolean; error?: string }, delta: string | undefined): void {
    const waiter = entry.waiters.shift();
    if (waiter) waiter(delta);
    else entry.queue.push(delta);
  }

  private async *streamHarnessPrompt(opts: { harness: string; sessionKey: string; system: string; user: string }): AsyncIterable<AcpPromptEvent> {
    let target: ConnectedRunner | undefined;
    for (const entry of this.connected.values()) {
      if (entry.worker.harnesses.includes(opts.harness)) {
        target = entry;
        break;
      }
    }
    if (!target) {
      throw new Error(
        `No Zagros Runner is online with the "${opts.harness}" harness. The harness CLI (with its login) must run on a Runner; the laptop-off rule applies to subscription logins.`
      );
    }
    const requestId = crypto.randomUUID();
    const entry: { queue: Array<string | undefined>; waiters: Array<(item: string | undefined) => void>; done: boolean; error?: string } = {
      queue: [],
      waiters: [],
      done: false,
    };
    this.pendingPrompts.set(requestId, entry);
    const message: ServerToRunner = {
      type: "harness.request",
      requestId,
      harness: opts.harness,
      method: "prompt",
      params: { sessionKey: opts.sessionKey, system: opts.system, user: opts.user },
    };
    target.socket.send(JSON.stringify(message));
    const watchdog = setTimeout(() => {
      const current = this.pendingPrompts.get(requestId);
      if (current) {
        current.done = true;
        current.error = "harness prompt timed out after 15 minutes";
        this.pushPromptDelta(current, undefined);
        this.pendingPrompts.delete(requestId);
      }
    }, 15 * 60 * 1000);
    const unref = (watchdog as { unref?: () => void }).unref;
    if (unref) unref.call(watchdog);
    try {
      for (;;) {
        const item = entry.queue.length > 0 ? entry.queue.shift() : await new Promise<string | undefined>((resolve) => entry.waiters.push(resolve));
        if (entry.error) throw new Error(entry.error);
        if (item) yield { type: "text", text: item };
        if (entry.done) break;
      }
    } finally {
      clearTimeout(watchdog);
    }
  }

  private pickWorker(capability?: keyof WorkerCapabilities): ConnectedRunner | undefined {
    for (const entry of this.connected.values()) {
      if (capability && !entry.worker.capabilities[capability]) continue;
      return entry;
    }
    return undefined;
  }

  private invokeRunnerTool(target: ConnectedRunner, toolId: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const requestId = crypto.randomUUID();
    return new Promise<ToolResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ ok: false, error: `Runner tool call timed out after ${RUNNER_TOOL_TIMEOUT_MS / 1000}s.` });
      }, RUNNER_TOOL_TIMEOUT_MS);
      this.pending.set(requestId, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
      });
      const message: ServerToRunner = {
        type: "tool.request",
        requestId,
        toolId,
        args: (args ?? {}) as Record<string, unknown>,
      };
      target.socket.send(JSON.stringify(message));
    });
  }

  async checkHeartbeats(): Promise<void> {
    for (const [workerId, entry] of this.connected) {
      if (entry.worker.lastSeenAt && Date.now() - Date.parse(entry.worker.lastSeenAt) > 60_000) {
        await this.handleRunnerClose(workerId);
        continue;
      }
      const ping: ServerToRunner = { type: "ping" };
      try {
        entry.socket.send(JSON.stringify(ping));
      } catch {
        await this.handleRunnerClose(workerId);
      }
    }
  }

  startHeartbeat(): void {
    const interval = setInterval(() => {
      void this.checkHeartbeats();
    }, 20_000);
    const unref = (interval as { unref?: () => void }).unref;
    if (unref) unref.call(interval);
  }
}

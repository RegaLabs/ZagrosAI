import { DurableObject } from "cloudflare:workers";
import { Kernel, type RunnerSocket } from "@zagros/kernel";
import { registerConnectors } from "@zagros/connectors";
import { runnerHelloSchema, type RunnerHello } from "@zagros/protocol";
import type { Task } from "@zagros/domain";
import { D1Repos } from "./d1-repos.js";
import { R2ObjectStore } from "./r2-store.js";
import { PushService } from "./push.js";
import type { Env } from "./env.js";

interface RunnerAdapterEntry {
  onMessage: ((data: string) => void) | null;
  onClose: (() => void) | null;
}

export class Hub extends DurableObject<Env> {
  private kernelPromise: Promise<Kernel> | undefined;
  private readonly clientSockets = new Set<WebSocket>();
  private readonly runnerAdapters = new Map<WebSocket, RunnerAdapterEntry>();
  private readonly hubRuns = new Map<string, { controller: AbortController; done: Promise<Task | undefined> }>();
  private heartbeatStarted = false;

  private getKernel(): Promise<Kernel> {
    if (!this.kernelPromise) {
      this.kernelPromise = this.buildKernel().catch((err) => {
        this.kernelPromise = undefined;
        throw err;
      });
    }
    return this.kernelPromise;
  }

  private async buildKernel(): Promise<Kernel> {
    const repos = new D1Repos(this.env.DB);
    const objects = new R2ObjectStore(this.env.FILES);
    const kernel = new Kernel(
      {
        defaultWorkspace: "",
        version: this.env.VERSION,
        stdioMcpEnabled: false,
        masterKey: this.env.ZAGROS_MASTER_KEY,
        publicBaseUrl: this.env.MAIN_URL ?? "http://127.0.0.1:8788",
        skillPublicKey: this.env.ZAGROS_SKILL_PUBLIC_KEY,
      },
      repos,
      objects
    );
    registerConnectors(kernel, {
      google: {
        clientId: this.env.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: this.env.GOOGLE_OAUTH_CLIENT_SECRET,
      },
      github: {
        clientId: this.env.GITHUB_OAUTH_CLIENT_ID,
        clientSecret: this.env.GITHUB_OAUTH_CLIENT_SECRET,
      },
    });
    if (this.env.ZAGROS_RUNNER_TOKEN) {
      const settings = await repos.getSettings();
      settings.runnerToken = this.env.ZAGROS_RUNNER_TOKEN;
      await repos.saveSettings(settings);
    }
    await kernel.init();
    kernel.events.subscribe((event) => {
      const payload = JSON.stringify(event);
      const activeClients = new Set([...this.clientSockets, ...this.ctx.getWebSockets("client")]);
      for (const socket of activeClients) {
        try {
          socket.send(payload);
        } catch {
        }
      }
      if (
        event.type === "task.updated" &&
        (event.task.status === "completed" || event.task.status === "failed" || event.task.status === "cancelled")
      ) {
        void this.notifyTaskDone(event.task).catch(() => {});
      }
      if (event.type === "approval.requested") {
        void this.notifyApprovalRequired(event.approval).catch(() => {});
      }
    });
    if (!this.heartbeatStarted) {
      this.heartbeatStarted = true;
      try {
        kernel.startHeartbeat();
      } catch {
      }
      void this.scheduleNextAlarm(kernel).catch(() => undefined);
    }
    return kernel;
  }

  override async alarm(): Promise<void> {
    try {
      const kernel = await this.getKernel();
      await kernel.routines.runDue().catch(() => undefined);
      await kernel.routines.sweepExpired().catch(() => undefined);
      await this.scheduleNextAlarm(kernel).catch(() => undefined);
    } catch {
      // guard against DO crash on alarm
    }
  }

  private async scheduleNextAlarm(kernel: Kernel): Promise<void> {
    try {
      const next = await kernel.routines.nextWakeup();
      if (next) {
        const parsed = Date.parse(next);
        if (!isNaN(parsed)) {
          const alarmTime = Math.max(parsed, Date.now() + 500);
          await this.ctx.storage.setAlarm(alarmTime);
          return;
        }
      }
      await this.ctx.storage.deleteAlarm().catch(() => undefined);
    } catch {
    }
  }

  private async notifyTaskDone(task: Task): Promise<void> {
    const repos = new D1Repos(this.env.DB);
    const agent = await repos.getAgent(task.agentId);
    const title = `${agent?.name ?? "Zagros"} · ${task.status}`;
    const body = task.status === "completed" ? "Your task finished." : (task.error ?? `Task ${task.status}.`);
    const push = new PushService(this.env.DB, this.env.VAPID_PUBLIC_KEY, this.env.VAPID_PRIVATE_KEY);
    await push.sendToAll(title, body, `/conversations/${task.conversationId}`);
  }

  private async notifyApprovalRequired(approval: { toolId: string; risk: string; conversationId?: string }): Promise<void> {
    const push = new PushService(this.env.DB, this.env.VAPID_PUBLIC_KEY, this.env.VAPID_PRIVATE_KEY);
    await push.sendToAll(
      "Zagros · approval required",
      `An agent wants to run ${approval.toolId} (risk ${approval.risk}). Tap to review.`,
      approval.conversationId ? `/conversations/${approval.conversationId}` : undefined
    );
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws") return this.upgradeClient();
    if (url.pathname === "/ws/runner") return this.upgradeRunner();
    if (url.pathname === "/task" && request.method === "POST") return this.handleTask(request);
    if (url.pathname === "/cancel" && request.method === "POST") return this.handleCancel(request);
    if (url.pathname === "/approve" && request.method === "POST") return this.handleApprove(request);
    if (url.pathname === "/tool-run" && request.method === "POST") return this.handleToolRun(request);
    if (url.pathname === "/routine-alarm" && request.method === "POST") {
      await this.scheduleNextAlarm(await this.getKernel());
      return this.json({ ok: true });
    }
    if (url.pathname === "/pause" && request.method === "POST") return this.handlePause(request);
    if (url.pathname === "/workers") return this.json(await (await this.getKernel()).workers.list());
    if (url.pathname === "/ping" && request.method === "POST") return this.json({ ok: true });
    return new Response("not found", { status: 404 });
  }

  private async handleToolRun(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as { toolId?: string; args?: unknown } | null;
    if (!body?.toolId) return this.json({ error: "missing_tool_id" }, 400);
    const kernel = await this.getKernel();
    const result = await kernel.executeTool(body.toolId, body.args ?? {});
    return this.json({ ok: result.ok, data: result.data, error: result.error, workerId: result.workerId });
  }

  private async handlePause(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as { taskId?: string; paused?: boolean } | null;
    if (!body?.taskId) return this.json({ error: "missing_task_id" }, 400);
    const kernel = await this.getKernel();
    const okResult = await kernel.setTaskPaused(body.taskId, body.paused === true);
    return this.json({ ok: okResult });
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  private async handleTask(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as { conversationId?: string; messageId?: string } | null;
    if (!body?.conversationId || !body?.messageId) return this.json({ error: "missing_conversation_or_message" }, 400);
    const kernel = await this.getKernel();
    const repos = kernel.repos;
    const conversation = await repos.getConversation(body.conversationId);
    if (!conversation) return this.json({ error: "conversation_not_found" }, 404);
    const messages = await repos.listMessages(body.conversationId);
    const userMessage = messages.find((m) => m.id === body.messageId && m.role === "user");
    if (!userMessage) return this.json({ error: "message_not_found" }, 404);
    const agent = await repos.getAgent(conversation.agentId);
    if (!agent) return this.json({ error: "agent_not_found" }, 500);

    const queued = (await repos.listTasks(200)).find(
      (t) => t.conversationId === conversation.id && t.messageId === userMessage.id && (t.status === "queued" || t.status === "running")
    );

    if (queued && this.hubRuns.has(queued.id)) {
      const existing = this.hubRuns.get(queued.id)!;
      const final = await existing.done.catch(() => undefined);
      return this.json({ ok: true, taskId: queued.id, status: final?.status ?? queued.status });
    }

    let task: Task;
    let done: Promise<Task | undefined>;
    if (queued) {
      task = queued;
      const controller = new AbortController();
      done = kernel.harness.run({ agent, conversation, userMessage, task, signal: controller.signal });
      this.hubRuns.set(task.id, { controller, done });
    } else {
      task = await kernel.startRun(conversation, agent, userMessage);
      done = kernel.waitForRun(task.id);
    }
    const final = await done.catch(() => undefined);
    this.hubRuns.delete(task.id);
    return this.json({ ok: true, taskId: task.id, status: final?.status ?? task.status });
  }

  private async handleApprove(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as { approvalId?: string; decision?: string } | null;
    if (!body?.approvalId || !body?.decision) return this.json({ error: "missing_fields" }, 400);
    const kernel = await this.getKernel();
    const decided = await kernel.approvals.decide(body.approvalId, body.decision as "approved" | "rejected" | "expired");
    return this.json({ ok: decided });
  }

  private async handleCancel(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as { taskId?: string } | null;
    if (!body?.taskId) return this.json({ error: "missing_task_id" }, 400);
    const kernel = await this.getKernel();
    const run = this.hubRuns.get(body.taskId);
    if (run) {
      run.controller.abort();
      return this.json({ ok: true });
    }
    const ok = kernel.cancelTask(body.taskId);
    return this.json({ ok });
  }

  private upgradeClient(): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, ["client"]);
    this.clientSockets.add(server);
    void this.getKernel()
      .then((kernel) =>
        kernel.initWsHello().then((hello) => {
          if (this.clientSockets.has(server) || this.ctx.getWebSockets("client").includes(server)) {
            try {
              server.send(JSON.stringify(hello));
            } catch {
            }
          }
        })
      )
      .catch(() => {});
    return new Response(null, { status: 101, webSocket: client });
  }

  private upgradeRunner(): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, ["runner"]);
    const entry: RunnerAdapterEntry = { onMessage: null, onClose: null };
    this.runnerAdapters.set(server, entry);
    return new Response(null, { status: 101, webSocket: client });
  }

  private makeRunnerSocket(server: WebSocket, entry: RunnerAdapterEntry): RunnerSocket {
    return {
      send: (data: string) => {
        try {
          server.send(data);
        } catch {
        }
      },
      close: (code?: number, reason?: string) => {
        try {
          server.close(code, reason);
        } catch {
        }
      },
      onMessage: (listener: (data: string) => void) => {
        entry.onMessage = listener;
      },
      onClose: (listener: () => void) => {
        entry.onClose = listener;
      },
    };
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    let entry = this.runnerAdapters.get(ws);
    if (!entry && this.ctx.getTags(ws).includes("runner")) {
      entry = { onMessage: null, onClose: null };
      this.runnerAdapters.set(ws, entry);
    }
    if (entry) {
      if (typeof message !== "string") return;
      if (entry.onMessage) {
        entry.onMessage(message);
        return;
      }
      let hello: RunnerHello;
      try {
        hello = runnerHelloSchema.parse(JSON.parse(message));
      } catch {
        return;
      }
      if (hello.type === "hello") {
        void this.getKernel()
          .then((kernel) =>
            kernel.workers.handleRunnerConnection(this.makeRunnerSocket(ws, entry!), hello).catch(() => {})
          )
          .catch(() => {});
      }
      return;
    }
    if (this.clientSockets.has(ws) || this.ctx.getTags(ws).includes("client")) {
      try {
        const parsed = JSON.parse(message as string) as { type?: string };
        if (parsed.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
      }
    }
  }

  override webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    const entry = this.runnerAdapters.get(ws);
    if (entry) {
      if (entry.onClose) {
        try {
          entry.onClose();
        } catch {
        }
      }
      this.runnerAdapters.delete(ws);
    }
    this.clientSockets.delete(ws);
  }

  override webSocketError(ws: WebSocket, _error: unknown): void {
    try {
      this.webSocketClose(ws, 1006, "Abnormal Closure", false);
    } catch {
    }
  }
}

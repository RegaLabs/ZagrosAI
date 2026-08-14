import { newId, now, type Agent, type Approval, type Attachment, type Conversation, type Message, type ModelConfig, type Settings, type Task } from "@zagros/domain";
import { createDriver, ModelRegistry, type ModelDriver, type AcpTransport } from "@zagros/models";
import { EcdsaSkillVerifier, EmptySkillSource, FsSkillSource, SkillManager } from "@zagros/skills";
import { browserToolMeta, createFileTools, createHttpTools, createShellTool, filesListToolMeta, ToolRegistry, type ToolResult } from "@zagros/tools";
import { McpManager } from "@zagros/mcp";
import { CredentialStore } from "@zagros/credentials";
import { RegaHarness, type ApprovalDecision, type HarnessDeps, type HarnessPersistence } from "@zagros/harness";
import type { EventBus, ServerEvent } from "@zagros/protocol";
import type { ObjectStore, Repos } from "@zagros/runtime";
import type { KernelConfig } from "./types.js";
import { detectKind } from "./types.js";
import { LocalEventBus } from "./events.js";
import { WorkerRegistry } from "./worker-registry.js";
import { ApprovalManager } from "./approval-manager.js";
import { MemoryManager } from "./memory.js";
import { OAuthBroker } from "./oauth/broker.js";
import { RoutineManager } from "./routines.js";
import { AuditChainer } from "./audit-chain.js";
import { createA2aCallTool, createArtifactTools, createDelegateTool } from "./multi-agent.js";

export class Kernel {
  readonly events: LocalEventBus;
  readonly tools = new ToolRegistry();
  readonly repos: Repos;
  readonly workers: WorkerRegistry;
  readonly harness: RegaHarness;
  readonly objects: ObjectStore;
  readonly approvals: ApprovalManager;
  readonly oauth: OAuthBroker;
  readonly store: CredentialStore;
  readonly mcpManager: McpManager;
  readonly memory: MemoryManager;
  readonly skills: SkillManager;
  readonly routines: RoutineManager;
  private readonly models = new ModelRegistry();
  private readonly driverCache = new Map<string, ModelDriver>();
  private readonly runs = new Map<string, { controller: AbortController; done: Promise<Task> }>();
  private readonly pausedTasks = new Set<string>();
  private runnerToken = "";
  private heartbeatStarted = false;
  private runtimeToolsRegistered = false;
  private rateWindow: Map<string, { count: number; resetAt: number }> = new Map();

  rateLimitOk(key: string): boolean {
    const limit = this.config.rateLimitPerMinute ?? 60;
    const now = Date.now();
    if (this.rateWindow.size > 200) {
      for (const [k, v] of this.rateWindow.entries()) {
        if (v.resetAt <= now) this.rateWindow.delete(k);
      }
    }
    const entry = this.rateWindow.get(key);
    if (!entry || entry.resetAt <= now) {
      this.rateWindow.set(key, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    if (entry.count >= limit) return false;
    entry.count++;
    return true;
  }

  async securityStatus(): Promise<Record<string, unknown>> {
    const workers = await this.workers.list();
    const recentAudit = await this.repos.listAudit(5);
    return {
      masterKeyConfigured: this.store.enabled,
      skillVerificationEnabled: Boolean(this.config.skillPublicKey),
      rateLimitPerMinute: this.config.rateLimitPerMinute ?? 60,
      maxConcurrentTasks: this.config.maxConcurrentTasks ?? 8,
      auditHashing: true,
      runnerCount: workers.filter((w) => w.online).length,
      harnesses: [...new Set(workers.flatMap((w) => w.harnesses))],
      recentAuditEvents: recentAudit.length,
      version: this.config.version,
    };
  }

  async scanDependencies(dir?: string): Promise<Record<string, unknown>> {
    const target = dir ?? ".";
    const run = (command: string): Promise<{ ok: boolean; output?: unknown; error?: string }> =>
      this.executeTool("shell.exec", { command, timeoutMs: 120000 });
    const pnpm = await run(`cd "${target}" 2>/dev/null || exit 1; pnpm audit --json 2>/dev/null`);
    if (pnpm.ok && pnpm.output) {
      return this.parseAudit(pnpm.output);
    }
    const npm = await run(`cd "${target}" 2>/dev/null || exit 1; npm audit --json 2>/dev/null`);
    if (npm.ok && npm.output) {
      return this.parseAudit(npm.output);
    }
    return { ok: false, error: "No package manager audit available (pnpm/npm not found or no manifest in the workspace)." };
  }

  private parseAudit(output: unknown): Record<string, unknown> {
    const text = typeof output === "string" ? output : JSON.stringify(output);
    try {
      const json = JSON.parse(text) as { metadata?: { vulnerabilities?: { total?: number; critical?: number; high?: number; moderate?: number; low?: number } } };
      const vulnerabilities = json.metadata?.vulnerabilities;
      const summary = vulnerabilities
        ? {
            total: vulnerabilities.total ?? 0,
            critical: vulnerabilities.critical ?? 0,
            high: vulnerabilities.high ?? 0,
            moderate: vulnerabilities.moderate ?? 0,
            low: vulnerabilities.low ?? 0,
          }
        : { total: 0, critical: 0, high: 0, moderate: 0, low: 0 };
      return { ok: true, summary };
    } catch {
      return { ok: true, summary: { total: 0, critical: 0, high: 0, moderate: 0, low: 0 }, raw: text.slice(0, 1000) };
    }
  }

  async concurrentTaskQuotaOk(): Promise<boolean> {
    const max = this.config.maxConcurrentTasks ?? 8;
    const tasks = await this.repos.listTasks(500);
    const active = tasks.filter((t) =>
      t.status === "queued" || t.status === "running" || t.status === "waiting_for_tool" || t.status === "waiting_for_approval"
    ).length;
    return active < max;
  }
  private secrets: string[] = [];

  async refreshSecrets(): Promise<void> {
    const secrets = new Set<string>();
    try {
      const settings = await this.repos.getSettings();
      if (settings.defaultModel.apiKey) secrets.add(settings.defaultModel.apiKey);
      for (const agent of await this.repos.listAgents()) {
        if (agent.model.apiKey) secrets.add(agent.model.apiKey);
        for (const fallback of agent.model.fallback ?? []) {
          if (fallback.apiKey) secrets.add(fallback.apiKey);
        }
      }
      for (const credential of await this.repos.listCredentials()) {
        try {
          const token = await this.store.decrypt<{ accessToken?: string; refreshToken?: string }>(credential.tokenJson);
          if (token.accessToken && token.accessToken.length > 12) secrets.add(token.accessToken);
          if (token.refreshToken) secrets.add(token.refreshToken);
        } catch {
          // undecryptable credentials are skipped
        }
      }
    } catch {
      // best effort
    }
    this.secrets = [...secrets].filter((secret) => secret.length >= 8);
  }

  scrubSecrets(text: string): string {
    let result = text;
    for (const secret of this.secrets) {
      if (result.includes(secret)) {
        result = result.split(secret).join("[REDACTED]");
      }
    }
    return result;
  }

  domainPolicy(url: string): string | undefined {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return undefined;
    }
    void this.repos;
    const policy = this.cachedPolicy;
    if (policy.allowedDomains.length > 0 && !policy.allowedDomains.includes(host)) {
      return `Domain policy: ${host} is not in the allowed domains list.`;
    }
    if (policy.blockedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
      return `Domain policy: ${host} is blocked.`;
    }
    return undefined;
  }

  private cachedPolicy: { blockedDomains: string[]; allowedDomains: string[] } = { blockedDomains: [], allowedDomains: [] };

  async refreshDomainPolicy(): Promise<void> {
    const settings = await this.repos.getSettings();
    const policy = settings.policy ?? { blockedDomains: [], allowedDomains: [] };
    this.cachedPolicy = policy;
  }

  private registerRuntimeTools(): void {
    if (this.runtimeToolsRegistered) return;
    this.runtimeToolsRegistered = true;
    const tools = [
      createDelegateTool(this),
      ...createArtifactTools(this),
      createA2aCallTool(this),
    ];
    for (const tool of tools) {
      if (!this.tools.get(tool.id)) this.tools.register(tool);
    }
  }

  constructor(
    readonly config: KernelConfig,
    repos: Repos,
    objects: ObjectStore
  ) {
    this.repos = new AuditChainer(repos) as unknown as Repos;
    this.objects = objects;
    this.events = new LocalEventBus();
    this.store = new CredentialStore(config.masterKey);
    this.mcpManager = new McpManager(this.tools, {
      store: this.store,
      repos,
      callbackBaseUrl: () => config.publicBaseUrl ?? "",
    });
    this.workers = new WorkerRegistry(this.repos, this.events, () => this.runnerToken);
    this.oauth = new OAuthBroker(this.repos, this.store);
    this.approvals = new ApprovalManager(this.repos, this.events);
    this.memory = new MemoryManager(this.repos);
    this.skills = new SkillManager(
      config.skillsDir ? new FsSkillSource(config.skillsDir) : new EmptySkillSource(),
      config.skillPublicKey ? new EcdsaSkillVerifier(config.skillPublicKey) : undefined
    );
    this.registerRuntimeTools();
    this.routines = new RoutineManager(
      this.repos,
      this.events,
      async (routine, prompt) => {
        const agent = await this.repos.getAgent(routine.agentId);
        if (!agent) throw new Error(`Agent not found: ${routine.agentId}`);
        const conversations = await this.repos.listConversations();
        let conversation = conversations.find((c) => c.title === `Routine: ${routine.name}`);
        const timestamp = now();
        if (!conversation) {
          conversation = {
            id: newId("conv"),
            title: `Routine: ${routine.name}`,
            agentId: agent.id,
            userId: "routine",
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          await this.repos.saveConversation(conversation);
        }
        const userMessage: Message = {
          id: newId("msg"),
          conversationId: conversation.id,
          agentId: agent.id,
          role: "user",
          content: prompt,
          attachments: [],
          createdAt: timestamp,
        };
        await this.repos.saveMessage(userMessage);
        const task = await this.startRun(conversation, agent, userMessage);
        return { taskId: task.id };
      },
      async (routine) => {
        const workers = await this.workers.list();
        const online = workers.filter((w) => w.online);
        for (const capability of routine.workerRequirements.capabilities) {
          if (!online.some((w) => w.capabilities[capability])) {
            const localNativeSupported =
              (capability === "shell" && Boolean(this.tools.get("shell.exec"))) ||
              (capability === "filesystem" && Boolean(this.tools.get("files.read")));
            if (!localNativeSupported) {
              return `Worker requirement unmet: no online Runner has the "${capability}" capability.`;
            }
          }
        }
        for (const harness of routine.workerRequirements.harnesses) {
          if (!online.some((w) => w.harnesses.includes(harness))) {
            return `Worker requirement unmet: no online Runner has the "${harness}" harness.`;
          }
        }
        return undefined;
      }
    );
    const deps: HarnessDeps = {
      models: this.models,
      tools: this.tools,
      events: this.events,
      persist: this.persistence,
      workspaceDir: config.defaultWorkspace,
      resolveAttachment: async (attachment) => this.resolveAttachment(attachment),
      resolveModel: (modelConfig) => this.resolveModel(modelConfig),
      requestApproval: async (request) =>
        (await this.approvals.request(
          request.task,
          request.step,
          request.call.name,
          request.step.toolArgs ?? {},
          request.tool.risk,
          `Tool ${request.call.name} is risk class ${request.tool.risk}`,
          request.signal
        )) as ApprovalDecision,
      shouldPause: (taskId) => this.pausedTasks.has(taskId),
      scrubSecrets: (text) => this.scrubSecrets(text),
      skills: {
        discover: (text) => this.skills.discover(text),
      },
      memory: {
        search: (query, opts) => this.memory.search(query, opts),
        propose: async (candidate) => {
          await this.memory.propose(candidate);
        },
        extract: (opts) => this.extractMemory(opts.agent, opts.conversation, opts.transcript),
      },
    };
    this.harness = new RegaHarness(deps);
  }

  async init(): Promise<void> {
    const settings = await this.repos.getSettings();
    this.runnerToken = settings.runnerToken ?? "";
    const tokenEnv = process.env.ZAGROS_RUNNER_TOKEN;
    if (tokenEnv && this.runnerToken !== tokenEnv) {
      this.runnerToken = tokenEnv;
      settings.runnerToken = tokenEnv;
      await this.repos.saveSettings(settings);
    }
    await this.rebuildTools(settings);
    await this.refreshDomainPolicy();
    await this.refreshSecrets();
    this.wireAudit();
  }

  async getSettings(): Promise<Settings> {
    return this.repos.getSettings();
  }

  async initWsHello(): Promise<ServerEvent> {
    return {
      type: "hello",
      server: { name: "zagros", version: this.config.version },
      state: {
        agents: await this.repos.listAgents(),
        conversations: await this.repos.listConversations(),
        tasks: await this.repos.listTasks(200),
        workers: await this.workers.list(),
        settings: this.maskSettings(await this.repos.getSettings()),
      },
    };
  }

  maskSettings(settings: Settings): Settings {
    return {
      ...settings,
      defaultModel: {
        ...settings.defaultModel,
        apiKey: settings.defaultModel.apiKey ? "••••••••••" : undefined,
      },
    };
  }

  async updateSettings(next: Settings): Promise<Settings> {
    const current = await this.repos.getSettings();
    if (next.defaultModel.apiKey === "••••••••••") {
      next.defaultModel.apiKey = current.defaultModel.apiKey;
    }
    await this.repos.saveSettings(next);
    await this.rebuildTools(next);
    await this.refreshDomainPolicy();
    await this.refreshSecrets();
    await this.repos.appendAudit({ id: newId("audit"), type: "settings.updated", createdAt: now() });
    this.events.emit({ type: "settings.updated", settings: this.maskSettings(next) });
    return next;
  }

  async rebuildTools(settings: Settings): Promise<void> {
    const nativeTools = createHttpTools((url) => this.domainPolicy(url));
    const shell = createShellTool(this.config.defaultWorkspace);
    const files = createFileTools(this.config.defaultWorkspace);
    const filesRead = files[0]!;
    const filesWrite = files[1]!;
    const candidates: Array<Parameters<ToolRegistry["register"]>[0]> = [
      ...nativeTools,
      this.workers.getRunnerToolDefinition("shell.exec", shell.description, "R1", shell.schema),
      this.workers.getRunnerToolDefinition("files.read", filesRead.description, "R0", filesRead.schema),
      this.workers.getRunnerToolDefinition("files.write", filesWrite.description, "R1", filesWrite.schema),
      this.workers.getRunnerToolDefinition(filesListToolMeta.id, filesListToolMeta.description, filesListToolMeta.risk, filesListToolMeta.schema),
      ...browserToolMeta.map((meta) =>
        this.workers.getRunnerToolDefinition(meta.id, meta.description, meta.risk, meta.schema)
      ),
    ];
    for (const tool of candidates) {
      if (!this.tools.get(tool.id)) this.tools.register(tool);
    }
    const result = await this.mcpManager.sync(settings.mcpServers, { stdioSupported: this.config.stdioMcpEnabled });
    for (const failed of result.failed) {
      await this.repos.appendAudit({
        id: newId("audit"),
        type: "mcp.connect_failed",
        detail: { serverId: failed.id, error: failed.error },
        createdAt: now(),
      });
    }
  }

  private resolveModel(modelConfig: ModelConfig): ModelDriver {
    const key = JSON.stringify(modelConfig);
    const cached = this.driverCache.get(key);
    if (cached) return cached;
    const acpTransport: AcpTransport | undefined =
      modelConfig.driver === "acp" ? this.workers.getHarnessTransport() : undefined;
    const driver = createDriver(modelConfig, { acpTransport });
    this.driverCache.set(key, driver);
    return driver;
  }

  async resolveAttachment(attachment: Attachment): Promise<{ data: string; mimeType?: string } | undefined> {
    if (!attachment.path) return undefined;
    const object = await this.objects.get(attachment.path);
    if (!object || object.data.byteLength > 20 * 1024 * 1024) return undefined;
    const mimeType = attachment.mimeType || "image/png";
    return {
      data: `data:${mimeType};base64,${bytesToBase64(object.data)}`,
      mimeType,
    };
  }

  async storeUpload(name: string, mimeType: string | undefined, data: Uint8Array): Promise<Attachment> {
    const id = newId("att");
    const safeName = name.replace(/[^\w.\-() ]/g, "_").slice(0, 120) || "upload.bin";
    const key = `${id}-${safeName}`;
    await this.objects.put(key, data, { contentType: mimeType });
    return {
      id,
      kind: detectKind(mimeType ?? "", safeName),
      name: safeName,
      mimeType: mimeType ?? "application/octet-stream",
      size: data.byteLength,
      path: key,
      url: this.objects.publicUrl(key),
      createdAt: now(),
    };
  }

  async startRun(conversation: Conversation, agent: Agent, userMessage: Message, parentTaskId?: string): Promise<Task> {
    if (this.startRunDelegate) return this.startRunDelegate(conversation, agent, userMessage);
    const task: Task = {
      id: newId("task"),
      conversationId: conversation.id,
      messageId: userMessage.id,
      agentId: agent.id,
      status: "queued",
      steps: [],
      modelCalls: 0,
      toolCalls: 0,
      paused: false,
      parentTaskId,
      createdAt: now(),
    };
    if (parentTaskId) {
      const parent = await this.repos.getTask(parentTaskId);
      if (parent) {
        const subtaskIds = Array.from(new Set([...(parent.subtaskIds ?? []), task.id]));
        await this.repos.saveTask({ ...parent, subtaskIds });
      }
    }
    await this.repos.saveTask(task);
    await this.repos.touchConversation(conversation.id, now());
    const controller = new AbortController();
    const done = this.harness
      .run({ agent, conversation, userMessage, task, signal: controller.signal })
      .finally(() => {
        this.runs.delete(task.id);
        this.pausedTasks.delete(task.id);
        void this.approvals.cancelPendingForTask(task.id);
      });
    this.runs.set(task.id, { controller, done });
    return task;
  }

  async waitForRun(taskId: string): Promise<Task | undefined> {
    const run = this.runs.get(taskId);
    if (!run) return this.repos.getTask(taskId);
    return run.done;
  }

  cancelTask(taskId: string): boolean {
    if (this.cancelTaskDelegate) return this.cancelTaskDelegate(taskId);
    void this.approvals.cancelPendingForTask(taskId);
    // Cascade cancellation to any active subtasks
    for (const [id, r] of this.runs.entries()) {
      if (id !== taskId) {
        void this.repos.getTask(id).then((subtask) => {
          if (subtask?.parentTaskId === taskId) {
            r.controller.abort();
            void this.approvals.cancelPendingForTask(id);
          }
        });
      }
    }
    const run = this.runs.get(taskId);
    if (!run) return false;
    run.controller.abort();
    return true;
  }

  startRunDelegate?: (conversation: Conversation, agent: Agent, userMessage: Message) => Promise<Task>;
  cancelTaskDelegate?: (taskId: string) => boolean;
  approvalDecideDelegate?: (id: string, decision: Approval["status"]) => Promise<boolean>;
  pauseTaskDelegate?: (taskId: string, paused: boolean) => Promise<boolean>;
  toolExecuteDelegate?: (toolId: string, args: unknown) => Promise<ToolResult>;

  private async extractMemory(agent: Agent, conversation: Conversation, transcript: string): Promise<void> {
    try {
      const driver = this.resolveModel(agent.model);
      if (!driver) return;
      const response = await driver.generate({
        messages: [
          {
            role: "system",
            content:
              "You are the Zagros memory extractor. Return ONLY a JSON array of memory candidates derived strictly from the conversation transcript. Each item has: {\"content\": string, \"kind\": \"episodic\" | \"semantic\", \"confidence\": number between 0 and 1}. episodic = what happened during this task; semantic = stable facts about the user, project or environment. Never invent facts not supported by the transcript. Return [] if nothing durable.",
          },
          { role: "user", content: transcript.slice(0, 12000) },
        ],
        temperature: 0,
        maxTokens: 800,
      });
      const text = response.text.trim();
      let candidates: unknown[] = [];
      const firstBracket = text.indexOf("[");
      const lastBracket = text.lastIndexOf("]");
      if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        const jsonText = text.slice(firstBracket, lastBracket + 1);
        try {
          candidates = JSON.parse(jsonText);
        } catch {
          // json parse error fallback
        }
      }
      if (!Array.isArray(candidates)) return;
      for (const candidate of candidates as Array<Record<string, unknown>>) {
        if (!candidate || typeof candidate !== "object") continue;
        if (typeof candidate.content !== "string" || !candidate.content.trim()) continue;
        const kind = candidate.kind === "semantic" ? "semantic" : candidate.kind === "procedural" ? "procedural" : "episodic";
        const scope = candidate.scope === "global" || candidate.scope === "project" ? candidate.scope : "agent";
        const confidence = typeof candidate.confidence === "number" ? Math.min(1, Math.max(0, candidate.confidence)) : 0.7;
        await this.memory.propose({
          content: candidate.content.trim().slice(0, 4000),
          kind,
          scope,
          confidence,
          source: `task:${conversation.id}`,
        });
      }
    } catch {
      // extraction is best-effort
    }
  }

  async executeTool(toolId: string, args: unknown): Promise<ToolResult> {
    if (this.toolExecuteDelegate) return this.toolExecuteDelegate(toolId, args);
    return this.tools.execute(toolId, args, { cwd: this.config.defaultWorkspace });
  }

  async setTaskPaused(taskId: string, paused: boolean): Promise<boolean> {
    if (this.pauseTaskDelegate) return this.pauseTaskDelegate(taskId, paused);
    const task = await this.repos.getTask(taskId);
    if (!task) return false;
    if (paused) {
      this.pausedTasks.add(taskId);
    } else {
      this.pausedTasks.delete(taskId);
    }
    task.paused = paused;
    await this.repos.saveTask(task);
    await this.repos.appendAudit({
      id: newId("audit"),
      type: paused ? "task.paused" : "task.resumed",
      taskId,
      createdAt: now(),
    });
    this.events.emit({ type: "task.updated", task: JSON.parse(JSON.stringify(task)) });
    return true;
  }

  scheduleRoutineWakeupDelegate?: () => Promise<void>;

  async scheduleRoutineWakeup(): Promise<void> {
    if (this.scheduleRoutineWakeupDelegate) {
      await this.scheduleRoutineWakeupDelegate();
    }
  }

  startRoutineLoop(): void {
    const tick = (): void => {
      void this.routines.runDue().catch(() => undefined);
      void this.routines.sweepExpired().catch(() => undefined);
    };
    tick();
    const interval = setInterval(tick, 10_000);
    const unref = (interval as { unref?: () => void }).unref;
    if (unref) unref.call(interval);
  }

  async decideApproval(id: string, decision: Approval["status"]): Promise<boolean> {
    if (this.approvalDecideDelegate) return this.approvalDecideDelegate(id, decision);
    return this.approvals.decide(id, decision);
  }

  private readonly persistence: HarnessPersistence = {
    getMessages: async (conversationId, limit) => this.repos.listMessages(conversationId, limit),
    saveMessage: async (message) => {
      await this.repos.saveMessage(message);
      await this.repos.touchConversation(message.conversationId, message.createdAt);
    },
    createTask: async (task) => {
      await this.repos.saveTask(task);
      return task;
    },
    updateTask: async (task) => {
      await this.repos.saveTask(task);
      return task;
    },
    getTask: async (id) => this.repos.getTask(id),
  };

  private wireAudit(): void {
    this.events.subscribe((event) => {
      if (event.type === "task.updated") {
        if (event.task.status === "completed" || event.task.status === "failed" || event.task.status === "cancelled") {
          void this.routines.onTaskTerminal(event.task).catch(() => undefined);
          void this.repos.appendAudit({
            id: newId("audit"),
            type: `task.${event.task.status}`,
            taskId: event.task.id,
            agentId: event.task.agentId,
            conversationId: event.task.conversationId,
            detail: event.task.error ? { error: event.task.error } : undefined,
            createdAt: now(),
          });
        }
      } else if (event.type === "task.created") {
        void this.repos.appendAudit({ id: newId("audit"), type: "task.created", taskId: event.task.id, agentId: event.task.agentId, conversationId: event.task.conversationId, createdAt: now() });
      } else if (event.type === "tool.started") {
        void this.repos.appendAudit({ id: newId("audit"), type: "tool.started", taskId: event.taskId, toolId: event.toolId, detail: { args: event.args, workerId: event.workerId }, createdAt: now() });
      } else if (event.type === "tool.completed") {
        void this.repos.appendAudit({ id: newId("audit"), type: "tool.completed", taskId: event.taskId, toolId: event.toolId, detail: { ok: event.ok, error: event.error }, createdAt: now() });
      } else if (event.type === "approval.requested") {
        void this.repos.appendAudit({ id: newId("audit"), type: "approval.requested", taskId: event.approval.taskId, toolId: event.approval.toolId, conversationId: event.approval.conversationId, detail: { risk: event.approval.risk, args: event.approval.toolArgs }, createdAt: now() });
      } else if (event.type === "approval.decided") {
        void this.repos.appendAudit({ id: newId("audit"), type: "approval.decided", taskId: event.approval.taskId, toolId: event.approval.toolId, conversationId: event.approval.conversationId, detail: { status: event.approval.status }, createdAt: now() });
      }
    });
  }

  startHeartbeat(): void {
    if (this.heartbeatStarted) return;
    this.heartbeatStarted = true;
    this.workers.startHeartbeat();
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export { detectKind, type KernelConfig } from "./types.js";
export type { HttpContext, HttpReply, HttpHandler, HttpRouteTable, RunnerSocket, WsClientSocket } from "./types.js";
export { ok, created, badRequest, notFound, serverError, jsonReply } from "./types.js";
export { LocalEventBus } from "./events.js";
export { WorkerRegistry } from "./worker-registry.js";
export type { EventBus, ServerEvent } from "@zagros/protocol";

import {
  newId,
  now,
  type Agent,
  type Attachment,
  type Conversation,
  type Message,
  type Routine,
  type RoutineTrigger,
  type Settings,
  type Task,
} from "@zagros/domain";
import {
  approvalDecideRequestSchema,
  approvalsQuerySchema,
  browserScreenshotRequestSchema,
  createAgentRequestSchema,
  createConversationRequestSchema,
  createMemoryRequestSchema,
  createRoutineRequestSchema,
  executeToolRequestSchema,
  importDataRequestSchema,
  installSkillRequestSchema,
  memoryQuerySchema,
  oauthCallbackQuerySchema,
  paginationQuerySchema,
  sendMessageRequestSchema,
  settingsUpdateRequestSchema,
  testRoutineRequestSchema,
  updateAgentRequestSchema,
  updateMemoryRequestSchema,
  updateRoutineRequestSchema,
} from "@zagros/protocol";
import { Kernel } from "./kernel.js";
import { buildAgentCard, handleA2aJsonRpc } from "./multi-agent.js";
import { handleA2aV1Messages, handleA2aV1Tasks } from "@zagros/a2a";
import {
  badRequest,
  created,
  forbidden,
  html,
  notFound,
  ok,
  redirect,
  serverError,
  tooManyRequests,
  unauthorized,
  unprocessable,
  type HttpReply,
  type HttpRouteTable,
} from "./types.js";

function route(path: string): string {
  return path;
}

export function buildHttpRoutes(kernel: Kernel): HttpRouteTable {
  const repos = kernel.repos;
  const table: HttpRouteTable = {
    get: new Map(),
    post: new Map(),
    put: new Map(),
    patch: new Map(),
    delete: new Map(),
  };

  table.get.set(route("/api/health"), async () =>
    ok({
      ok: true,
      name: "zagros",
      version: kernel.config.version,
      uptimeSeconds: Math.round(process.uptime()),
    })
  );

  table.get.set(route("/api/agents"), async () => ok(await repos.listAgents()));

  table.post.set(route("/api/agents"), async (ctx): Promise<HttpReply> => {
    const parsed = createAgentRequestSchema.safeParse(ctx.body);
    if (!parsed.success) return badRequest({ error: "invalid_agent", issues: parsed.error.issues });
    const nowIso = now();
    const agent: Agent = {
      id: newId("agent"),
      name: parsed.data.name,
      systemPrompt: parsed.data.systemPrompt,
      model: parsed.data.model ?? (await kernel.getSettings()).defaultModel,
      permissions: parsed.data.permissions ?? { denyTools: [], approvalTools: [] },
      group: parsed.data.group,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await repos.saveAgent(agent);
    await repos.appendAudit({
      id: newId("audit"),
      type: "agent.created",
      agentId: agent.id,
      detail: { name: agent.name },
      createdAt: nowIso,
    });
    await kernel.refreshSecrets();
    return created(agent);
  });

  table.patch.set(route("/api/agents/:id"), async (ctx): Promise<HttpReply> => {
    const existing = await repos.getAgent(ctx.params["id"] ?? "");
    if (!existing) return notFound({ error: "agent_not_found" });
    const parsed = updateAgentRequestSchema.safeParse(ctx.body);
    if (!parsed.success) return badRequest({ error: "invalid_agent", issues: parsed.error.issues });
    const agent: Agent = {
      ...existing,
      name: parsed.data.name ?? existing.name,
      systemPrompt: parsed.data.systemPrompt ?? existing.systemPrompt,
      model: parsed.data.model ?? existing.model,
      permissions: parsed.data.permissions ?? existing.permissions,
      group: parsed.data.group !== undefined ? parsed.data.group : existing.group,
      updatedAt: now(),
    };
    await repos.saveAgent(agent);
    await kernel.refreshSecrets();
    return ok(agent);
  });

  table.delete.set(route("/api/agents/:id"), async (ctx): Promise<HttpReply> => {
    const existing = await repos.getAgent(ctx.params["id"] ?? "");
    if (!existing) return notFound({ error: "agent_not_found" });
    await repos.deleteAgent(ctx.params["id"]!);
    await repos.appendAudit({
      id: newId("audit"),
      type: "agent.deleted",
      agentId: ctx.params["id"],
      createdAt: now(),
    });
    return ok({ ok: true });
  });

  table.get.set(route("/api/conversations"), async (): Promise<HttpReply> => {
    const conversations = await repos.listConversations();
    const agents = new Map((await repos.listAgents()).map((a) => [a.id, a]));
    const result = [];
    for (const c of conversations) {
      const messages = await repos.listMessages(c.id, 1);
      const last = messages[messages.length - 1];
      result.push({
        ...c,
        agentName: agents.get(c.agentId)?.name ?? "unknown",
        lastMessage: last?.role === "tool" ? undefined : last?.content.slice(0, 120),
        lastMessageAt: last?.createdAt ?? c.updatedAt,
      });
    }
    return ok(result);
  });

  table.post.set(route("/api/conversations"), async (ctx): Promise<HttpReply> => {
    const parsed = createConversationRequestSchema.safeParse(ctx.body);
    if (!parsed.success) return badRequest({ error: "invalid_conversation", issues: parsed.error.issues });
    const agent = await repos.getAgent(parsed.data.agentId);
    if (!agent) return notFound({ error: "agent_not_found" });
    const timestamp = now();
    const conversation: Conversation = {
      id: newId("conv"),
      title: parsed.data.title ?? `Chat with ${agent.name}`,
      agentId: agent.id,
      userId: "local-user",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await repos.saveConversation(conversation);
    kernel.events.emit({ type: "conversation.created", conversation });
    return created(conversation);
  });

  table.get.set(route("/api/conversations/:id"), async (ctx): Promise<HttpReply> => {
    const conversation = await repos.getConversation(ctx.params["id"] ?? "");
    if (!conversation) return notFound({ error: "conversation_not_found" });
    return ok({
      conversation,
      messages: await repos.listMessages(ctx.params["id"]!),
    });
  });

  table.delete.set(route("/api/conversations/:id"), async (ctx): Promise<HttpReply> => {
    const conversation = await repos.getConversation(ctx.params["id"] ?? "");
    if (!conversation) return notFound({ error: "conversation_not_found" });
    await repos.deleteConversation(ctx.params["id"]!);
    return ok({ ok: true });
  });

  table.post.set(route("/api/conversations/:id/messages"), async (ctx): Promise<HttpReply> => {
    const clientKey = ctx.ip ?? "unknown";
    if (!kernel.rateLimitOk(clientKey)) {
      return tooManyRequests({ error: "rate_limit_exceeded" });
    }
    if (!(await kernel.concurrentTaskQuotaOk())) {
      return tooManyRequests({ error: "task_quota_exceeded" });
    }
    const conversation = await repos.getConversation(ctx.params["id"] ?? "");
    if (!conversation) return notFound({ error: "conversation_not_found" });
    const parsed = sendMessageRequestSchema.safeParse(ctx.body);
    if (!parsed.success) return badRequest({ error: "invalid_message", issues: parsed.error.issues });
    const agent = await repos.getAgent(conversation.agentId);
    if (!agent) return serverError({ error: "agent_missing" });
    const attachments: Attachment[] = [];
    for (const incoming of parsed.data.attachments) {
      const upload = await repos.getUpload(incoming.attachmentId);
      if (upload) attachments.push(upload);
    }
    const timestamp = now();
    const userMessage: Message = {
      id: newId("msg"),
      conversationId: conversation.id,
      agentId: agent.id,
      role: "user",
      content: parsed.data.content,
      attachments,
      createdAt: timestamp,
    };
    await repos.saveMessage(userMessage);
    const task = await kernel.startRun(conversation, agent, userMessage);
    await repos.appendAudit({
      id: newId("audit"),
      type: "message.sent",
      taskId: task.id,
      agentId: agent.id,
      conversationId: conversation.id,
      detail: { content: userMessage.content.slice(0, 200), attachments: attachments.map((a) => a.id) },
      createdAt: timestamp,
    });
    return created({ message: userMessage, task });
  });

  table.get.set(route("/api/tasks"), async (ctx): Promise<HttpReply> => {
    const parsed = paginationQuerySchema.safeParse(ctx.query);
    const limit = parsed.success && parsed.data.limit ? Math.min(parsed.data.limit, 500) : 100;
    return ok(await repos.listTasks(limit));
  });

  table.get.set(route("/api/tasks/:id"), async (ctx): Promise<HttpReply> => {
    const task = await repos.getTask(ctx.params["id"] ?? "");
    if (!task) return notFound({ error: "task_not_found" });
    return ok(task);
  });

  table.post.set(route("/api/tasks/:id/cancel"), async (ctx): Promise<HttpReply> => {
    const task = await repos.getTask(ctx.params["id"] ?? "");
    if (!task) return notFound({ error: "task_not_found" });
    const cancelled = kernel.cancelTask(task.id);
    if (!cancelled && task.status === "queued") {
      task.status = "cancelled";
      task.completedAt = now();
      await repos.saveTask(task);
      kernel.events.emit({ type: "task.updated", task });
    }
    return ok({ ok: true, task: await repos.getTask(task.id) });
  });

  table.get.set(route("/api/workers"), async () => ok(await kernel.workers.list()));

  table.get.set(route("/api/tools"), async () =>
    ok(
      kernel.tools.list().map((t) => ({
        id: t.id,
        provider: t.provider,
        description: t.description,
        risk: t.risk,
      }))
    )
  );

  table.get.set(route("/api/settings"), async () => ok(kernel.maskSettings(await kernel.getSettings())));

  table.put.set(route("/api/settings"), async (ctx): Promise<HttpReply> => {
    const parsed = settingsUpdateRequestSchema.safeParse(ctx.body);
    if (!parsed.success) return badRequest({ error: "invalid_settings", issues: parsed.error.issues });
    const current = await kernel.getSettings();
    const next: Settings = {
      defaultModel: parsed.data.defaultModel ?? current.defaultModel,
      mcpServers: parsed.data.mcpServers ?? current.mcpServers,
      runnerToken: current.runnerToken,
      runnerWhitelist: current.runnerWhitelist,
      offline: (parsed.data as { offline?: Settings["offline"] }).offline ?? current.offline,
      policy: parsed.data.policy ?? current.policy,
    };
    const saved = await kernel.updateSettings(next);
    return ok(kernel.maskSettings(saved));
  });

  table.get.set(route("/api/audit"), async (ctx): Promise<HttpReply> => {
    const parsed = paginationQuerySchema.safeParse(ctx.query);
    const limit = parsed.success && parsed.data.limit ? Math.min(parsed.data.limit, 500) : 100;
    return ok(await repos.listAudit(limit));
  });

  table.post.set(route("/api/uploads"), async (ctx): Promise<HttpReply> => {
    if (!ctx.upload) return badRequest({ error: "no_file" });
    try {
      const attachment = await kernel.storeUpload(ctx.upload.name, ctx.upload.mimeType, ctx.upload.data);
      await repos.saveUpload(attachment);
      return created({
        attachmentId: attachment.id,
        kind: attachment.kind,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        url: attachment.url,
      });
    } catch (err) {
      return serverError({ error: err instanceof Error ? err.message : "upload_failed" });
    }
  });

  table.get.set(route("/api/oauth/providers"), async (): Promise<HttpReply> =>
    ok({ providers: kernel.oauth.listProviders(), enabled: kernel.store.enabled })
  );

  table.get.set(route("/api/oauth/:provider/authorize"), async (ctx): Promise<HttpReply> => {
    const providerId = ctx.params["provider"] ?? "";
    if (!kernel.oauth.hasProvider(providerId)) return notFound({ error: "unknown_provider" });
    if (!kernel.store.enabled) {
      return serverError({ error: "OAuth connectors are disabled: set ZAGROS_MASTER_KEY first." });
    }
    try {
      const authorizeUrl = await kernel.oauth.beginAuthorization(providerId, callbackUri(ctx, providerId));
      return redirect(authorizeUrl);
    } catch (err) {
      return serverError({ error: err instanceof Error ? err.message : "oauth_begin_failed" });
    }
  });

  table.get.set(route("/api/oauth/:provider/callback"), async (ctx): Promise<HttpReply> => {
    const providerId = ctx.params["provider"] ?? "";
    const parsed = oauthCallbackQuerySchema.safeParse(ctx.query);
    if (!parsed.success) return badRequest({ error: "missing_code_or_state", issues: parsed.error.issues });
    const { code, state } = parsed.data;
    try {
      const connector = await kernel.oauth.completeAuthorization(providerId, code, state, callbackUri(ctx, providerId));
      void kernel.refreshSecrets();
      kernel.events.emit({ type: "connector.connected", connector });
      return html(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zagros · Connected</title></head>` +
          `<body style="font-family:system-ui;background:#0e1013;color:#f2f3f5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">` +
          `<div style="text-align:center;max-width:420px;padding:24px;background:#1c1f24;border-radius:16px;border:1px solid rgba(255,255,255,0.1)">` +
          `<h1 style="font-size:20px;margin:0 0 8px">Connected</h1>` +
          `<p style="color:#9aa1ac;margin:0 0 16px">${escapeHtml(connector.providerLabel)} · ${escapeHtml(connector.account)}</p>` +
          `<p style="color:#9aa1ac;font-size:14px;margin:0">You can close this tab and return to Zagros.</p>` +
          `</div></body></html>`
      );
    } catch (err) {
      return html(
        `<!doctype html><html><head><meta charset="utf-8"><title>Zagros · OAuth failed</title></head>` +
          `<body style="font-family:system-ui;background:#0e1013;color:#f2f3f5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">` +
          `<div style="text-align:center;max-width:420px;padding:24px;background:#1c1f24;border-radius:16px;border:1px solid rgba(255,255,255,0.1)">` +
          `<h1 style="font-size:20px;margin:0 0 8px">Connection failed</h1>` +
          `<p style="color:#9aa1ac;margin:0">${escapeHtml(err instanceof Error ? err.message : "oauth_failed")}</p>` +
          `</div></body></html>`
      );
    }
  });

  table.get.set(route("/api/connectors"), async (): Promise<HttpReply> => ok(await kernel.oauth.list()));

  table.delete.set(route("/api/connectors/:id"), async (ctx): Promise<HttpReply> => {
    const id = ctx.params["id"] ?? "";
    const removed = await kernel.oauth.revoke(id);
    if (!removed) return notFound({ error: "connector_not_found" });
    void kernel.refreshSecrets();
    kernel.events.emit({ type: "connector.removed", connectorId: id });
    return ok({ ok: true });
  });

  table.get.set(route("/api/approvals"), async (ctx): Promise<HttpReply> => {
    const parsed = approvalsQuerySchema.safeParse(ctx.query);
    const limit = parsed.success && parsed.data.limit ? Math.min(parsed.data.limit, 200) : 50;
    const taskId = parsed.success ? parsed.data.taskId : undefined;
    return ok(await kernel.approvals.list(taskId || undefined, limit));
  });

  table.post.set(route("/api/approvals/:id/decide"), async (ctx): Promise<HttpReply> => {
    const parsed = approvalDecideRequestSchema.safeParse(ctx.body);
    if (!parsed.success) return badRequest({ error: "invalid_decision", issues: parsed.error.issues });
    const decided = await kernel.decideApproval(ctx.params["id"] ?? "", parsed.data.decision);
    if (!decided) return notFound({ error: "approval_not_found_or_already_decided" });
    return ok({ ok: true });
  });

  table.post.set(route("/api/tasks/:id/pause"), async (ctx): Promise<HttpReply> => {
    const okResult = await kernel.setTaskPaused(ctx.params["id"] ?? "", true);
    if (!okResult) return notFound({ error: "task_not_found" });
    return ok({ ok: true });
  });

  table.post.set(route("/api/tasks/:id/resume"), async (ctx): Promise<HttpReply> => {
    const okResult = await kernel.setTaskPaused(ctx.params["id"] ?? "", false);
    if (!okResult) return notFound({ error: "task_not_found" });
    return ok({ ok: true });
  });

  const EXECUTOR_WHITELIST: Array<{ prefix: string } | { exact: string }> = [
    { exact: "files.list" },
    { exact: "files.read" },
    { prefix: "browser." },
  ];

  table.post.set(route("/api/executor/tool"), async (ctx): Promise<HttpReply> => {
    const parsed = executeToolRequestSchema.safeParse(ctx.body);
    if (!parsed.success) return badRequest({ error: "invalid_tool_request", issues: parsed.error.issues });
    const { toolId, args } = parsed.data;
    const allowed = EXECUTOR_WHITELIST.some((entry) =>
      "exact" in entry ? entry.exact === toolId : toolId.startsWith(entry.prefix)
    );
    if (!allowed) return badRequest({ error: "tool_not_whitelisted" });
    const result = await kernel.executeTool(toolId, args);
    return ok({ ok: result.ok, data: result.data, error: result.error, workerId: result.workerId });
  });

  table.get.set(route("/api/browser/sessions"), async (): Promise<HttpReply> => {
    const result = await kernel.executeTool("browser.session.list", {});
    if (!result.ok) return serverError({ error: result.error ?? "browser_unavailable" });
    return ok(result.data);
  });

  table.post.set(route("/api/browser/screenshot"), async (ctx): Promise<HttpReply> => {
    const parsed = browserScreenshotRequestSchema.safeParse(ctx.body);
    if (!parsed.success) return badRequest({ error: "invalid_screenshot_request", issues: parsed.error.issues });
    const result = await kernel.executeTool("browser.screenshot", { sessionId: parsed.data.sessionId });
    if (!result.ok) return serverError({ error: result.error ?? "screenshot_failed" });
    return ok(result.data);
  });

  table.get.set(route("/api/memories"), async (ctx): Promise<HttpReply> => {
    const parsed = memoryQuerySchema.safeParse(ctx.query);
    const q = parsed.success ? parsed.data.q : undefined;
    const kind = parsed.success ? parsed.data.kind : undefined;
    const limit = parsed.success && parsed.data.limit ? Math.min(parsed.data.limit, 200) : 200;
    if (q) {
      return ok(await kernel.memory.search(q, { limit: 50, kind }));
    }
    const memories = await kernel.memory.list(limit);
    return ok(kind ? memories.filter((m) => m.kind === kind) : memories);
  });

  table.post.set(route("/api/memories"), async (ctx): Promise<HttpReply> => {
    const parsed = createMemoryRequestSchema.safeParse(ctx.body);
    if (!parsed.success) return badRequest({ error: "invalid_memory", issues: parsed.error.issues });
    const memory = await kernel.memory.create({
      content: parsed.data.content,
      kind: parsed.data.kind,
      scope: parsed.data.scope,
      confidence: parsed.data.confidence,
      expiresAt: parsed.data.expiresAt,
    });
    return created(memory);
  });

  table.patch.set(route("/api/memories/:id"), async (ctx): Promise<HttpReply> => {
    const id = ctx.params["id"] ?? "";
    if (!id) return badRequest({ error: "missing_id" });
    const parsed = updateMemoryRequestSchema.safeParse(ctx.body);
    if (!parsed.success) return badRequest({ error: "invalid_memory_patch", issues: parsed.error.issues });
    const patch: Record<string, unknown> = {};
    if (parsed.data.content !== undefined) patch.content = parsed.data.content;
    if (parsed.data.confidence !== undefined) patch.confidence = parsed.data.confidence;
    if (parsed.data.expiresAt !== undefined) patch.expiresAt = parsed.data.expiresAt ?? undefined;
    const updated = await kernel.memory.update(id, patch);
    if (!updated) return notFound({ error: "memory_not_found" });
    return ok(updated);
  });

  table.delete.set(route("/api/memories/:id"), async (ctx): Promise<HttpReply> => {
    const id = ctx.params["id"] ?? "";
    if (!id) return badRequest({ error: "missing_id" });
    const removed = await kernel.memory.remove(id);
    if (!removed) return notFound({ error: "memory_not_found" });
    return ok({ ok: true });
  });

  table.get.set(route("/api/skills"), async (): Promise<HttpReply> => {
    const skills = await kernel.skills.refresh();
    return ok({ skills, supported: Boolean(kernel.config.skillsDir) });
  });

  table.get.set(route("/api/skills/:name"), async (ctx): Promise<HttpReply> => {
    const name = ctx.params["name"] ?? "";
    if (!name) return badRequest({ error: "missing_name" });
    const skill = await kernel.skills.get(name);
    if (!skill) return notFound({ error: "skill_not_found" });
    return ok(skill);
  });

  table.post.set(route("/api/skills/install"), async (ctx): Promise<HttpReply> => {
    if (!kernel.config.skillsDir) {
      return serverError({ error: "Skill installs require the local filesystem runtime (git). Skills on the Cloudflare runtime arrive in a later release." });
    }
    const parsed = installSkillRequestSchema.safeParse(ctx.body);
    if (!parsed.success) return badRequest({ error: "invalid_skill_install", issues: parsed.error.issues });
    try {
      const skill = await kernel.skills.install(parsed.data.source);
      return created({ ok: true, skill });
    } catch (err) {
      return serverError({ error: err instanceof Error ? err.message : "skill_install_failed" });
    }
  });

  table.delete.set(route("/api/skills/:name"), async (ctx): Promise<HttpReply> => {
    const name = ctx.params["name"] ?? "";
    if (!name) return badRequest({ error: "missing_name" });
    if (!kernel.config.skillsDir) return serverError({ error: "skills require the local filesystem runtime" });
    const removed = await kernel.skills.remove(name);
    if (!removed) return notFound({ error: "skill_not_found" });
    return ok({ ok: true });
  });

  table.post.set(route("/api/skills/:name/test"), async (ctx): Promise<HttpReply> => {
    const name = ctx.params["name"] ?? "";
    if (!name) return badRequest({ error: "missing_name" });
    if (!kernel.config.skillsDir) return serverError({ error: "skills require the local filesystem runtime" });
    try {
      const results = await kernel.skills.runTests(name, (command) =>
        kernel.executeTool("shell.exec", { command })
      );
      return ok({ ok: results.every((r) => r.ok), results });
    } catch (err) {
      return serverError({ error: err instanceof Error ? err.message : "skill_test_failed" });
    }
  });

  table.get.set(route("/api/routines"), async (): Promise<HttpReply> => ok(await kernel.routines.list()));

  table.get.set(route("/api/routines/:id"), async (ctx): Promise<HttpReply> => {
    const id = ctx.params["id"] ?? "";
    if (!id) return badRequest({ error: "missing_id" });
    const routine = await kernel.routines.get(id);
    if (!routine) return notFound({ error: "routine_not_found" });
    return ok(routine);
  });

  table.post.set(route("/api/routines"), async (ctx): Promise<HttpReply> => {
    const parsed = createRoutineRequestSchema.safeParse(ctx.body);
    if (!parsed.success) return badRequest({ error: "invalid_routine", issues: parsed.error.issues });
    const timestamp = now();
    const routine: Routine = {
      id: newId("routine"),
      name: parsed.data.name,
      description: parsed.data.description,
      trigger: parsed.data.trigger,
      agentId: parsed.data.agentId,
      prompt: parsed.data.prompt,
      skill: parsed.data.skill,
      enabled: parsed.data.enabled,
      retry: parsed.data.retry ?? { attempts: 1, backoffMs: 5000, deadLetter: true },
      workerRequirements: parsed.data.workerRequirements ?? { capabilities: [], harnesses: [] },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const saved = await kernel.routines.create(routine);
    await kernel.scheduleRoutineWakeup();
    return created(saved);
  });

  table.patch.set(route("/api/routines/:id"), async (ctx): Promise<HttpReply> => {
    const id = ctx.params["id"] ?? "";
    if (!id) return badRequest({ error: "missing_id" });
    const parsed = updateRoutineRequestSchema.safeParse(ctx.body);
    if (!parsed.success) return badRequest({ error: "invalid_routine_patch", issues: parsed.error.issues });
    const patch: Partial<Routine> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.description !== undefined) patch.description = parsed.data.description;
    if (parsed.data.prompt !== undefined) patch.prompt = parsed.data.prompt;
    if (parsed.data.skill !== undefined) patch.skill = parsed.data.skill === null ? undefined : parsed.data.skill;
    if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
    if (parsed.data.trigger !== undefined) patch.trigger = parsed.data.trigger;
    if (parsed.data.retry !== undefined) patch.retry = parsed.data.retry;
    if (parsed.data.workerRequirements !== undefined) patch.workerRequirements = parsed.data.workerRequirements;
    const updated = await kernel.routines.update(id, patch);
    if (!updated) return notFound({ error: "routine_not_found" });
    await kernel.scheduleRoutineWakeup();
    return ok(updated);
  });

  table.delete.set(route("/api/routines/:id"), async (ctx): Promise<HttpReply> => {
    const id = ctx.params["id"] ?? "";
    if (!id) return badRequest({ error: "missing_id" });
    const removed = await kernel.routines.remove(id);
    if (!removed) return notFound({ error: "routine_not_found" });
    await kernel.scheduleRoutineWakeup();
    return ok({ ok: true });
  });

  table.post.set(route("/api/routines/:id/run"), async (ctx): Promise<HttpReply> => {
    const id = ctx.params["id"] ?? "";
    if (!id) return badRequest({ error: "missing_id" });
    try {
      const run = await kernel.routines.run(id, {});
      return created(run);
    } catch (err) {
      return notFound({ error: err instanceof Error ? err.message : "routine_run_failed" });
    }
  });

  table.post.set(route("/api/routines/:id/test"), async (ctx): Promise<HttpReply> => {
    const id = ctx.params["id"] ?? "";
    if (!id) return badRequest({ error: "missing_id" });
    const parsed = testRoutineRequestSchema.safeParse(ctx.body);
    if (!parsed.success) return badRequest({ error: "invalid_test_payload", issues: parsed.error.issues });
    try {
      const run = await kernel.routines.run(id, {
        payload: parsed.data.payload ?? { test: true },
        test: true,
      });
      return created(run);
    } catch (err) {
      return notFound({ error: err instanceof Error ? err.message : "routine_test_failed" });
    }
  });

  table.get.set(route("/api/routines/:id/runs"), async (ctx): Promise<HttpReply> => {
    const id = ctx.params["id"] ?? "";
    if (!id) return badRequest({ error: "missing_id" });
    return ok(await kernel.routines.runs(id, 50));
  });

  table.get.set(route("/api/routines/runs"), async (): Promise<HttpReply> => ok(await kernel.routines.runs(undefined, 100)));

  table.post.set(route("/api/webhooks/:path"), async (ctx): Promise<HttpReply> => {
    const rawPath = ctx.params["path"] ?? "";
    if (!rawPath) return badRequest({ error: "missing_path" });
    const cleanPath = rawPath.replace(/^\/+|\/+$/g, "");
    const routines = await kernel.routines.list();
    const routine = routines.find(
      (r) =>
        r.enabled &&
        r.trigger.type === "webhook" &&
        r.trigger.path.replace(/^\/+|\/+$/g, "").toLowerCase() === cleanPath.toLowerCase()
    );
    if (!routine) return notFound({ error: "webhook_not_found" });

    const triggerSecret = (routine.trigger as { secret?: string }).secret;
    if (triggerSecret) {
      const sigHeader =
        ctx.headers["x-hub-signature-256"] ||
        ctx.headers["x-webhook-signature"] ||
        ctx.headers["x-zagros-signature"] ||
        ctx.headers["x-webhook-secret"] ||
        ctx.headers["x-zagros-secret"] ||
        (ctx.headers["authorization"]?.startsWith("Bearer ") ? ctx.headers["authorization"].slice(7) : undefined);

      if (!sigHeader) {
        return unauthorized({ error: "missing_webhook_signature" });
      }
      const rawBody = typeof ctx.body === "string" ? ctx.body : JSON.stringify(ctx.body ?? {});
      const isValid = await verifyWebhookSignature(triggerSecret, rawBody, sigHeader);
      if (!isValid) {
        return unauthorized({ error: "invalid_webhook_signature" });
      }
    }

    const payload =
      typeof ctx.body === "object" && ctx.body !== null ? (ctx.body as Record<string, unknown>) : {};
    const run = await kernel.routines.run(routine.id, { payload });
    return created({ ok: true, run });
  });

  table.post.set(route("/api/events/:name"), async (ctx): Promise<HttpReply> => {
    const name = ctx.params["name"] ?? "";
    if (!name) return badRequest({ error: "missing_name" });
    const payload =
      typeof ctx.body === "object" && ctx.body !== null ? (ctx.body as Record<string, unknown>) : {};
    const runs = await kernel.routines.triggerEvent(name, payload);
    return created({ ok: true, runs });
  });

  table.post.set(route("/api/push/subscribe"), async (): Promise<HttpReply> => ok({ ok: true }));
  table.post.set(route("/api/push/unsubscribe"), async (): Promise<HttpReply> => ok({ ok: true }));
  table.post.set(route("/api/push/test"), async (): Promise<HttpReply> => ok({ ok: true, sent: 0, skipped: true }));

  table.get.set(route("/api/a2a/agents"), async (ctx): Promise<HttpReply> => {
    const agents = await repos.listAgents();
    const base = a2aBaseUrl(ctx);
    return ok(
      agents.map((agent) => ({
        agentId: agent.id,
        name: agent.name,
        cardUrl: `${base}/a2a/${agent.id}/.well-known/agent.json`,
        jsonrpcUrl: `${base}/a2a/${agent.id}/jsonrpc`,
      }))
    );
  });

  table.get.set(route("/a2a/:agentId/.well-known/agent.json"), async (ctx): Promise<HttpReply> => {
    const agentId = ctx.params["agentId"] ?? "";
    if (!agentId) return badRequest({ error: "missing_agent_id" });
    const agent = await repos.getAgent(agentId);
    if (!agent) return notFound({ error: "agent_not_found" });
    const card = buildAgentCard(kernel, agent, a2aBaseUrl(ctx));
    return ok(card);
  });

  const a2aDeps = {
    getAgent: async (id: string) => repos.getAgent(id),
    listAgents: async () => repos.listAgents(),
    runAgentTask: async (agent: Agent, text: string, sessionId?: string) => {
      const timestamp = now();
      const title = "A2A exchange";
      const conversations = await repos.listConversations();
      let conversation = conversations.find((c) => c.title === title && c.agentId === agent.id && c.userId === "a2a");
      if (!conversation) {
        conversation = {
          id: newId("conv"),
          title,
          agentId: agent.id,
          userId: "a2a",
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        await repos.saveConversation(conversation);
      }
      const userMessage: Message = {
        id: newId("msg"),
        conversationId: conversation.id,
        agentId: agent.id,
        role: "user",
        content: text,
        attachments: [],
        createdAt: timestamp,
      };
      await repos.saveMessage(userMessage);
      const task = await kernel.startRun(conversation, agent, userMessage);
      const result = await kernel.waitForRun(task.id);
      const messages = await repos.listMessages(conversation.id);
      const reply = [...messages].reverse().find((m) => m.role === "assistant" && m.content)?.content ?? "";
      return { taskId: task.id, reply };
    },
    getTask: async (taskId: string) => {
      const t = await repos.getTask(taskId);
      if (!t) return undefined;
      return {
        id: t.id,
        status: t.status,
        agentId: t.agentId,
        result: t.error ? undefined : "Task completed",
        error: t.error,
        createdAt: t.createdAt,
        completedAt: t.completedAt,
      };
    },
  };

  table.get.set(route("/.well-known/agent.json"), async (ctx): Promise<HttpReply> => {
    const agents = await repos.listAgents();
    if (agents.length === 0) return notFound({ error: "no_agents" });
    const card = buildAgentCard(kernel, agents[0]!, a2aBaseUrl(ctx));
    return ok(card);
  });

  table.get.set(route("/a2a/v1/agent-card"), async (ctx): Promise<HttpReply> => {
    const agentId = ctx.query["agentId"];
    const agents = await repos.listAgents();
    const agent = agentId ? await repos.getAgent(agentId) : agents[0];
    if (!agent) return notFound({ error: "agent_not_found" });
    const card = buildAgentCard(kernel, agent, a2aBaseUrl(ctx));
    return ok(card);
  });

  table.post.set(route("/a2a/v1/messages"), async (ctx): Promise<HttpReply> => {
    const res = await handleA2aV1Messages(a2aDeps, ctx.body, a2aBaseUrl(ctx));
    return { status: res.status, body: res.body };
  });

  table.post.set(route("/a2a/v1/tasks"), async (ctx): Promise<HttpReply> => {
    const res = await handleA2aV1Tasks(a2aDeps, ctx.body, a2aBaseUrl(ctx));
    return { status: res.status, body: res.body };
  });

  table.get.set(route("/a2a/v1/tasks/:id"), async (ctx): Promise<HttpReply> => {
    const id = ctx.params["id"] ?? "";
    if (!id) return badRequest({ error: "missing_id" });
    const task = await repos.getTask(id);
    if (!task) return notFound({ error: "task_not_found" });
    return ok(task);
  });

  table.post.set(route("/a2a/:agentId/jsonrpc"), async (ctx): Promise<HttpReply> => {
    const agentId = ctx.params["agentId"] ?? "";
    if (!agentId) return badRequest({ error: "missing_agent_id" });
    const agent = await repos.getAgent(agentId);
    if (!agent) return notFound({ error: "agent_not_found" });
    const result = await handleA2aJsonRpc(kernel, agent, ctx.body, a2aBaseUrl(ctx));
    return ok(result);
  });

  table.get.set(route("/api/artifacts"), async (): Promise<HttpReply> => ok(await repos.listArtifacts(100)));

  table.get.set(route("/api/security/status"), async (): Promise<HttpReply> => ok(await kernel.securityStatus()));

  table.post.set(route("/api/security/deps-scan"), async (ctx): Promise<HttpReply> => {
    const body = (ctx.body ?? {}) as { dir?: string };
    const result = await kernel.scanDependencies(typeof body.dir === "string" ? body.dir : undefined);
    return ok(result);
  });

  table.get.set(route("/api/export"), async (): Promise<HttpReply> =>
    ok({ version: kernel.config.version, exportedAt: now(), data: await repos.exportAll() })
  );

  table.post.set(route("/api/import"), async (ctx): Promise<HttpReply> => {
    const parsed = importDataRequestSchema.safeParse(ctx.body);
    if (!parsed.success) return badRequest({ error: "invalid_import_data", issues: parsed.error.issues });
    const count = await repos.importAll(parsed.data.data);
    return ok({ ok: true, imported: count });
  });

  table.get.set(route("/api/mcp/servers"), async (): Promise<HttpReply> =>
    ok({
      servers: (await kernel.getSettings()).mcpServers.map((server) => ({
        id: server.id,
        name: server.name,
        transport: server.transport,
        url: server.url,
        oauth: kernel.mcpManager.oauthStatus(server.id),
      })),
    })
  );

  table.get.set(route("/api/mcp/servers/:id/auth"), async (ctx): Promise<HttpReply> => {
    const serverId = ctx.params["id"] ?? "";
    if (!serverId) return badRequest({ error: "missing_id" });
    if (!kernel.store.enabled) {
      return serverError({ error: "MCP OAuth is disabled: set ZAGROS_MASTER_KEY first." });
    }
    try {
      const { authorizationUrl } = await kernel.mcpManager.beginOAuth(serverId);
      return redirect(authorizationUrl);
    } catch (err) {
      return serverError({ error: err instanceof Error ? err.message : "mcp_oauth_begin_failed" });
    }
  });

  table.get.set(route("/api/mcp/oauth/callback"), async (ctx): Promise<HttpReply> => {
    const parsed = oauthCallbackQuerySchema.safeParse(ctx.query);
    if (!parsed.success) return badRequest({ error: "missing_code_or_state", issues: parsed.error.issues });
    const { code, state } = parsed.data;
    const result = await kernel.mcpManager.completeOAuth(state, code);
    if (!result.ok) {
      return html(
        `<!doctype html><html><head><meta charset="utf-8"><title>Zagros · MCP connection failed</title></head>` +
          `<body style="font-family:system-ui;background:#0e1013;color:#f2f3f5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">` +
          `<div style="text-align:center;max-width:420px;padding:24px;background:#1c1f24;border-radius:16px;border:1px solid rgba(255,255,255,0.1)">` +
          `<h1 style="font-size:20px;margin:0 0 8px">MCP connection failed</h1>` +
          `<p style="color:#9aa1ac;margin:0">${escapeHtml(result.error ?? "unknown error")}</p>` +
          `</div></body></html>`
      );
    }
    return html(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zagros · MCP connected</title></head>` +
        `<body style="font-family:system-ui;background:#0e1013;color:#f2f3f5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">` +
        `<div style="text-align:center;max-width:420px;padding:24px;background:#1c1f24;border-radius:16px;border:1px solid rgba(255,255,255,0.1)">` +
        `<h1 style="font-size:20px;margin:0 0 8px">MCP server connected</h1>` +
        `<p style="color:#9aa1ac;font-size:14px;margin:0">You can close this tab and return to Zagros. The server's tools are now available to your agents.</p>` +
        `</div></body></html>`
    );
  });

  return table;
}

function a2aBaseUrl(ctx: { headers: Record<string, string> }): string {
  const host = ctx.headers["x-forwarded-host"] ?? ctx.headers["host"] ?? "localhost";
  const proto = ctx.headers["x-forwarded-proto"] ?? "http";
  return `${proto}://${host}`;
}

function callbackUri(ctx: { headers: Record<string, string> }, providerId: string): string {
  const host = ctx.headers["x-forwarded-host"] ?? ctx.headers["host"] ?? "localhost";
  const proto = ctx.headers["x-forwarded-proto"] ?? "http";
  return `${proto}://${host}/api/oauth/${encodeURIComponent(providerId)}/callback`;
}

async function verifyWebhookSignature(
  secret: string,
  rawPayload: string,
  signatureHeader: string
): Promise<boolean> {
  const normalizedSig = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice(7)
    : signatureHeader;

  if (normalizedSig === secret) return true;

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(rawPayload)
    );
    const signatureBytes = new Uint8Array(signatureBuffer);
    const expectedHex = Array.from(signatureBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return expectedHex.toLowerCase() === normalizedSig.toLowerCase();
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

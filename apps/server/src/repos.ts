import type {
  Agent,
  Approval,
  Artifact,
  Attachment,
  AuditEvent,
  Conversation,
  Credential,
  Memory,
  Message,
  OAuthPending,
  Routine,
  RoutineRun,
  Settings,
  Task,
  Worker,
} from "@zagros/domain";
import { defaultSettings, settingsSchema } from "@zagros/domain";
import { randomBytes } from "node:crypto";
import type { Repos } from "@zagros/runtime";
import type { Store } from "./store.js";

const EXPORT_TABLES = [
  "settings",
  "agents",
  "conversations",
  "messages",
  "tasks",
  "workers",
  "uploads",
  "approvals",
  "credentials",
  "oauth_pending",
  "memories",
  "artifacts",
  "routines",
  "routine_runs",
  "audit",
];

type AgentRow = {
  id: string;
  name: string;
  system_prompt: string;
  model_json: string;
  permissions_json: string;
  group_name: string | null;
  created_at: string;
  updated_at: string;
};

type RoutineRunRow = {
  id: string;
  routine_id: string;
  task_id: string;
  status: string;
  attempts: number;
  payload_json: string | null;
  error: string | null;
  test: number;
  started_at: string;
  finished_at: string | null;
};

type ApprovalRow = {
  id: string;
  task_id: string;
  step_id: string;
  conversation_id: string | null;
  tool_id: string;
  tool_args_json: string;
  risk: string;
  reason: string | null;
  status: string;
  created_at: string;
  decided_at: string | null;
  expires_at: string;
};

function jsonParse<T>(value: string | undefined, fallback: T): T {
  if (value === undefined || value === null || value === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export class SqliteRepos implements Repos {
  constructor(private readonly store: Store) {}

  async getSettings(): Promise<Settings> {
    const row = this.store.db.prepare("SELECT value FROM settings WHERE key = ?").get("main") as
      | { value: string }
      | undefined;
    const parsed = jsonParse<Settings>(row?.value, undefined as never);
    if (parsed === undefined) {
      const settings = { ...defaultSettings(), runnerToken: randomBytes(16).toString("hex") };
      await this.saveSettings(settings);
      return settings;
    }
    return settingsSchema.parse(parsed);
  }

  async saveSettings(settings: Settings): Promise<void> {
    this.store.db
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run("main", JSON.stringify(settings));
  }

  async listAgents(): Promise<Agent[]> {
    const rows = this.store.db.prepare("SELECT * FROM agents ORDER BY created_at").all() as AgentRow[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      systemPrompt: r.system_prompt,
      model: jsonParse(r.model_json, defaultSettings().defaultModel),
      permissions: jsonParse(r.permissions_json, { denyTools: [], approvalTools: [] }),
      group: r.group_name ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async getAgent(id: string): Promise<Agent | undefined> {
    const row = this.store.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      systemPrompt: row.system_prompt,
      model: jsonParse(row.model_json, defaultSettings().defaultModel),
      permissions: jsonParse(row.permissions_json, { denyTools: [], approvalTools: [] }),
      group: row.group_name ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async saveAgent(agent: Agent): Promise<void> {
    this.store.db
      .prepare(
        `INSERT OR REPLACE INTO agents (id, name, system_prompt, model_json, permissions_json, group_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        agent.id,
        agent.name,
        agent.systemPrompt,
        JSON.stringify(agent.model),
        JSON.stringify(agent.permissions ?? { denyTools: [], approvalTools: [] }),
        agent.group ?? null,
        agent.createdAt,
        agent.updatedAt
      );
  }

  async deleteAgent(id: string): Promise<void> {
    this.store.db.prepare("DELETE FROM agents WHERE id = ?").run(id);
  }

  async listConversations(): Promise<Conversation[]> {
    const rows = this.store.db.prepare("SELECT * FROM conversations ORDER BY updated_at DESC").all() as Array<{
      id: string;
      title: string;
      agent_id: string;
      user_id: string;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      agentId: r.agent_id,
      userId: r.user_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    const row = this.store.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as
      | {
          id: string;
          title: string;
          agent_id: string;
          user_id: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      title: row.title,
      agentId: row.agent_id,
      userId: row.user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    this.store.db
      .prepare(
        `INSERT OR REPLACE INTO conversations (id, title, agent_id, user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        conversation.id,
        conversation.title,
        conversation.agentId,
        conversation.userId,
        conversation.createdAt,
        conversation.updatedAt
      );
  }

  async touchConversation(id: string, at: string): Promise<void> {
    this.store.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(at, id);
  }

  async deleteConversation(id: string): Promise<void> {
    this.store.transaction(() => {
      this.store.db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
      this.store.db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
      this.store.db.prepare("DELETE FROM tasks WHERE conversation_id = ?").run(id);
    });
  }

  async listMessages(conversationId: string, limit?: number): Promise<Message[]> {
    const stmt = limit
      ? this.store.db.prepare(
          "SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?) ORDER BY created_at ASC"
        )
      : this.store.db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC");
    const rows = (limit ? stmt.all(conversationId, limit) : stmt.all(conversationId)) as Array<{
      id: string;
      conversation_id: string;
      agent_id: string;
      role: string;
      content: string;
      attachments_json: string;
      tool_calls_json: string | null;
      tool_call_id: string | null;
      tool_name: string | null;
      created_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      agentId: r.agent_id,
      role: r.role as Message["role"],
      content: r.content,
      attachments: jsonParse(r.attachments_json, []),
      toolCalls: r.tool_calls_json ? jsonParse(r.tool_calls_json, []) : undefined,
      toolCallId: r.tool_call_id ?? undefined,
      toolName: r.tool_name ?? undefined,
      createdAt: r.created_at,
    }));
  }

  async saveMessage(message: Message): Promise<void> {
    this.store.db
      .prepare(
        `INSERT OR REPLACE INTO messages (id, conversation_id, agent_id, role, content, attachments_json, tool_calls_json, tool_call_id, tool_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        message.id,
        message.conversationId,
        message.agentId,
        message.role,
        message.content,
        JSON.stringify(message.attachments ?? []),
        message.toolCalls ? JSON.stringify(message.toolCalls) : null,
        message.toolCallId ?? null,
        message.toolName ?? null,
        message.createdAt
      );
  }

  async listTasks(limit = 100): Promise<Task[]> {
    const rows = this.store.db
      .prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Array<{
      id: string;
      conversation_id: string;
      message_id: string;
      agent_id: string;
      status: string;
      steps_json: string;
      error: string | null;
      model_calls: number;
      tool_calls: number;
      paused: number;
      created_at: string;
      started_at: string | null;
      completed_at: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      messageId: r.message_id,
      agentId: r.agent_id,
      status: r.status as Task["status"],
      steps: jsonParse(r.steps_json, []),
      error: r.error ?? undefined,
      modelCalls: r.model_calls,
      toolCalls: r.tool_calls,
      paused: r.paused === 1,
      createdAt: r.created_at,
      startedAt: r.started_at ?? undefined,
      completedAt: r.completed_at ?? undefined,
    }));
  }

  async getTask(id: string): Promise<Task | undefined> {
    const row = this.store.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
      | {
          id: string;
          conversation_id: string;
          message_id: string;
          agent_id: string;
          status: string;
          steps_json: string;
          error: string | null;
          model_calls: number;
          tool_calls: number;
          paused: number;
          created_at: string;
          started_at: string | null;
          completed_at: string | null;
        }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      conversationId: row.conversation_id,
      messageId: row.message_id,
      agentId: row.agent_id,
      status: row.status as Task["status"],
      steps: jsonParse(row.steps_json, []),
      error: row.error ?? undefined,
      modelCalls: row.model_calls,
      toolCalls: row.tool_calls,
      paused: row.paused === 1,
      createdAt: row.created_at,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
    };
  }

  async saveTask(task: Task): Promise<void> {
    this.store.db
      .prepare(
        `INSERT OR REPLACE INTO tasks (id, conversation_id, message_id, agent_id, status, steps_json, error, model_calls, tool_calls, paused, created_at, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        task.id,
        task.conversationId,
        task.messageId,
        task.agentId,
        task.status,
        JSON.stringify(task.steps),
        task.error ?? null,
        task.modelCalls,
        task.toolCalls,
        task.paused ? 1 : 0,
        task.createdAt,
        task.startedAt ?? null,
        task.completedAt ?? null
      );
  }

  async listWorkers(): Promise<Worker[]> {
    const rows = this.store.db.prepare("SELECT * FROM workers ORDER BY name").all() as Array<{
      id: string;
      name: string;
      os: string;
      arch: string;
      capabilities_json: string;
      models_json: string;
      harnesses_json: string;
      online: number;
      connected_at: string | null;
      last_seen_at: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      os: r.os,
      arch: r.arch,
      capabilities: jsonParse(r.capabilities_json, { shell: false, filesystem: false, browser: false, docker: false, gpu: false }),
      models: jsonParse(r.models_json, []),
      harnesses: jsonParse(r.harnesses_json, []),
      online: r.online === 1,
      connectedAt: r.connected_at ?? undefined,
      lastSeenAt: r.last_seen_at ?? undefined,
    }));
  }

  async saveWorker(worker: Worker): Promise<void> {
    this.store.db
      .prepare(
        `INSERT OR REPLACE INTO workers (id, name, os, arch, capabilities_json, models_json, harnesses_json, online, connected_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        worker.id,
        worker.name,
        worker.os,
        worker.arch,
        JSON.stringify(worker.capabilities),
        JSON.stringify(worker.models),
        JSON.stringify(worker.harnesses),
        worker.online ? 1 : 0,
        worker.connectedAt ?? null,
        worker.lastSeenAt ?? null
      );
  }

  async saveUpload(attachment: Attachment): Promise<void> {
    this.store.db
      .prepare(
        `INSERT OR REPLACE INTO uploads (id, name, kind, mime_type, size, path, url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        attachment.id,
        attachment.name,
        attachment.kind,
        attachment.mimeType,
        attachment.size,
        attachment.path ?? "",
        attachment.url ?? "",
        attachment.createdAt
      );
  }

  async getUpload(id: string): Promise<Attachment | undefined> {
    const row = this.store.db.prepare("SELECT * FROM uploads WHERE id = ?").get(id) as
      | {
          id: string;
          name: string;
          kind: string;
          mime_type: string;
          size: number;
          path: string;
          url: string;
          created_at: string;
        }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      kind: row.kind as Attachment["kind"],
      mimeType: row.mime_type,
      size: row.size,
      path: row.path || undefined,
      url: row.url || undefined,
      createdAt: row.created_at,
    };
  }

  async appendAudit(event: AuditEvent): Promise<void> {
    this.store.db
      .prepare(
        `INSERT INTO audit (id, type, task_id, agent_id, conversation_id, tool_id, detail_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.id,
        event.type,
        event.taskId ?? null,
        event.agentId ?? null,
        event.conversationId ?? null,
        event.toolId ?? null,
        event.detail ? JSON.stringify(event.detail) : null,
        event.createdAt
      );
  }

  async saveApproval(approval: Approval): Promise<void> {
    this.store.db
      .prepare(
        `INSERT OR REPLACE INTO approvals (id, task_id, step_id, conversation_id, tool_id, tool_args_json, risk, reason, status, created_at, decided_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        approval.id,
        approval.taskId,
        approval.stepId,
        approval.conversationId ?? null,
        approval.toolId,
        JSON.stringify(approval.toolArgs ?? {}),
        approval.risk,
        approval.reason ?? null,
        approval.status,
        approval.createdAt,
        approval.decidedAt ?? null,
        approval.expiresAt
      );
  }

  async getApproval(id: string): Promise<Approval | undefined> {
    const row = this.store.db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as
      | {
          id: string;
          task_id: string;
          step_id: string;
          conversation_id: string | null;
          tool_id: string;
          tool_args_json: string;
          risk: string;
          reason: string | null;
          status: string;
          created_at: string;
          decided_at: string | null;
          expires_at: string;
        }
      | undefined;
    return row ? this.mapApproval(row) : undefined;
  }

  async listApprovals(taskId?: string, limit = 50): Promise<Approval[]> {
    const rows = taskId
      ? (this.store.db
          .prepare("SELECT * FROM approvals WHERE task_id = ? ORDER BY created_at DESC LIMIT ?")
          .all(taskId, limit) as unknown as ApprovalRow[])
      : (this.store.db.prepare("SELECT * FROM approvals ORDER BY created_at DESC LIMIT ?").all(limit) as unknown as ApprovalRow[]);
    return rows.map((r) => this.mapApproval(r));
  }

  async updateApprovalStatus(id: string, status: Approval["status"], decidedAt?: string): Promise<void> {
    this.store.db
      .prepare("UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?")
      .run(status, decidedAt ?? null, id);
  }

  private mapApproval(row: ApprovalRow): Approval {
    return {
      id: row.id,
      taskId: row.task_id,
      stepId: row.step_id,
      conversationId: row.conversation_id ?? undefined,
      toolId: row.tool_id,
      toolArgs: jsonParse(row.tool_args_json, {}),
      risk: row.risk as Approval["risk"],
      reason: row.reason ?? undefined,
      status: row.status as Approval["status"],
      createdAt: row.created_at,
      decidedAt: row.decided_at ?? undefined,
      expiresAt: row.expires_at,
    };
  }

  async saveCredential(credential: Credential): Promise<void> {
    this.store.db
      .prepare(
        `INSERT OR REPLACE INTO credentials (id, provider, account, scopes_json, token_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        credential.id,
        credential.provider,
        credential.account,
        JSON.stringify(credential.scopes),
        credential.tokenJson,
        credential.createdAt,
        credential.updatedAt
      );
  }

  async getCredential(id: string): Promise<Credential | undefined> {
    const row = this.store.db.prepare("SELECT * FROM credentials WHERE id = ?").get(id) as
      | {
          id: string;
          provider: string;
          account: string;
          scopes_json: string;
          token_json: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      provider: row.provider,
      account: row.account,
      scopes: jsonParse(row.scopes_json, []),
      tokenJson: row.token_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async listCredentials(): Promise<Credential[]> {
    const rows = this.store.db.prepare("SELECT * FROM credentials ORDER BY created_at").all() as Array<{
      id: string;
      provider: string;
      account: string;
      scopes_json: string;
      token_json: string;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      account: r.account,
      scopes: jsonParse(r.scopes_json, []),
      tokenJson: r.token_json,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async deleteCredential(id: string): Promise<void> {
    this.store.db.prepare("DELETE FROM credentials WHERE id = ?").run(id);
  }

  async savePendingAuth(pending: OAuthPending): Promise<void> {
    this.store.db
      .prepare(
        `INSERT OR REPLACE INTO oauth_pending (state, provider, redirect_uri, verifier_encrypted, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        pending.state,
        pending.provider,
        pending.redirectUri,
        pending.verifierEncrypted,
        pending.expiresAt,
        pending.createdAt
      );
  }

  async getPendingAuth(state: string): Promise<OAuthPending | undefined> {
    const row = this.store.db.prepare("SELECT * FROM oauth_pending WHERE state = ?").get(state) as
      | {
          state: string;
          provider: string;
          redirect_uri: string;
          verifier_encrypted: string;
          expires_at: string;
          created_at: string;
        }
      | undefined;
    if (!row) return undefined;
    return {
      state: row.state,
      provider: row.provider,
      redirectUri: row.redirect_uri,
      verifierEncrypted: row.verifier_encrypted,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }

  async deletePendingAuth(state: string): Promise<void> {
    this.store.db.prepare("DELETE FROM oauth_pending WHERE state = ?").run(state);
  }

  async listRoutines(): Promise<Routine[]> {
    const rows = this.store.db.prepare("SELECT * FROM routines ORDER BY created_at").all() as Array<{
      id: string;
      name: string;
      description: string;
      trigger_json: string;
      agent_id: string;
      prompt: string;
      skill: string | null;
      enabled: number;
      retry_json: string;
      worker_req_json: string;
      created_at: string;
      updated_at: string;
      last_run_at: string | null;
      last_status: string | null;
      next_run_at: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      trigger: jsonParse(r.trigger_json, { type: "manual" }),
      agentId: r.agent_id,
      prompt: r.prompt,
      skill: r.skill ?? undefined,
      enabled: r.enabled === 1,
      retry: jsonParse(r.retry_json, { attempts: 1, backoffMs: 5000, deadLetter: true }),
      workerRequirements: jsonParse(r.worker_req_json, { capabilities: [], harnesses: [] }),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastRunAt: r.last_run_at ?? undefined,
      lastStatus: (r.last_status ?? undefined) as Routine["lastStatus"],
      nextRunAt: r.next_run_at ?? undefined,
    }));
  }

  async getRoutine(id: string): Promise<Routine | undefined> {
    const row = this.store.db.prepare("SELECT * FROM routines WHERE id = ?").get(id) as
      | {
          id: string;
          name: string;
          description: string;
          trigger_json: string;
          agent_id: string;
          prompt: string;
          skill: string | null;
          enabled: number;
          retry_json: string;
          worker_req_json: string;
          created_at: string;
          updated_at: string;
          last_run_at: string | null;
          last_status: string | null;
          next_run_at: string | null;
        }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      trigger: jsonParse(row.trigger_json, { type: "manual" }),
      agentId: row.agent_id,
      prompt: row.prompt,
      skill: row.skill ?? undefined,
      enabled: row.enabled === 1,
      retry: jsonParse(row.retry_json, { attempts: 1, backoffMs: 5000, deadLetter: true }),
      workerRequirements: jsonParse(row.worker_req_json, { capabilities: [], harnesses: [] }),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastRunAt: row.last_run_at ?? undefined,
      lastStatus: (row.last_status ?? undefined) as Routine["lastStatus"],
      nextRunAt: row.next_run_at ?? undefined,
    };
  }

  async saveRoutine(routine: Routine): Promise<void> {
    this.store.db
      .prepare(
        `INSERT OR REPLACE INTO routines (id, name, description, trigger_json, agent_id, prompt, skill, enabled, retry_json, worker_req_json, created_at, updated_at, last_run_at, last_status, next_run_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        routine.id,
        routine.name,
        routine.description,
        JSON.stringify(routine.trigger),
        routine.agentId,
        routine.prompt,
        routine.skill ?? null,
        routine.enabled ? 1 : 0,
        JSON.stringify(routine.retry),
        JSON.stringify(routine.workerRequirements),
        routine.createdAt,
        routine.updatedAt,
        routine.lastRunAt ?? null,
        routine.lastStatus ?? null,
        routine.nextRunAt ?? null
      );
  }

  async deleteRoutine(id: string): Promise<void> {
    this.store.db.prepare("DELETE FROM routines WHERE id = ?").run(id);
    this.store.db.prepare("DELETE FROM routine_runs WHERE routine_id = ?").run(id);
  }

  async listRoutineRuns(routineId?: string, limit = 50): Promise<RoutineRun[]> {
    const rows = routineId
      ? (this.store.db
          .prepare("SELECT * FROM routine_runs WHERE routine_id = ? ORDER BY started_at DESC LIMIT ?")
          .all(routineId, limit) as unknown as RoutineRunRow[])
      : (this.store.db.prepare("SELECT * FROM routine_runs ORDER BY started_at DESC LIMIT ?").all(limit) as unknown as RoutineRunRow[]);
    return rows.map((r) => ({
      id: r.id,
      routineId: r.routine_id,
      taskId: r.task_id,
      status: r.status as RoutineRun["status"],
      attempts: r.attempts,
      payload: r.payload_json ? jsonParse(r.payload_json, {}) : undefined,
      error: r.error ?? undefined,
      test: r.test === 1,
      startedAt: r.started_at,
      finishedAt: r.finished_at ?? undefined,
    }));
  }

  async saveRoutineRun(run: RoutineRun): Promise<void> {
    this.store.db
      .prepare(
        `INSERT OR REPLACE INTO routine_runs (id, routine_id, task_id, status, attempts, payload_json, error, test, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        run.id,
        run.routineId,
        run.taskId,
        run.status,
        run.attempts,
        run.payload ? JSON.stringify(run.payload) : null,
        run.error ?? null,
        run.test ? 1 : 0,
        run.startedAt,
        run.finishedAt ?? null
      );
  }

  async getArtifact(key: string): Promise<Artifact | undefined> {
    const row = this.store.db.prepare("SELECT * FROM artifacts WHERE key = ?").get(key) as
      | {
          id: string;
          key: string;
          value: string;
          agent_id: string | null;
          conversation_id: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      key: row.key,
      value: row.value,
      agentId: row.agent_id ?? undefined,
      conversationId: row.conversation_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async saveArtifact(artifact: Artifact): Promise<void> {
    this.store.db
      .prepare(
        `INSERT OR REPLACE INTO artifacts (id, key, value, agent_id, conversation_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        artifact.id,
        artifact.key ?? artifact.id,
        artifact.value ?? "",
        artifact.agentId ?? null,
        artifact.conversationId ?? null,
        artifact.createdAt,
        artifact.updatedAt
      );
  }

  async listArtifacts(limit = 100): Promise<Artifact[]> {
    const rows = this.store.db.prepare("SELECT * FROM artifacts ORDER BY updated_at DESC LIMIT ?").all(limit) as Array<{
      id: string;
      key: string;
      value: string;
      agent_id: string | null;
      conversation_id: string | null;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      value: r.value,
      agentId: r.agent_id ?? undefined,
      conversationId: r.conversation_id ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async listMemories(limit = 200): Promise<Memory[]> {
    const rows = this.store.db.prepare("SELECT * FROM memories ORDER BY updated_at DESC LIMIT ?").all(limit) as Array<{
      id: string;
      kind: string;
      scope: string;
      content: string;
      confidence: number;
      source: string | null;
      tags_json: string;
      expires_at: string | null;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as Memory["kind"],
      scope: r.scope as Memory["scope"],
      content: r.content,
      confidence: r.confidence,
      source: r.source ?? undefined,
      tags: jsonParse(r.tags_json, []),
      expiresAt: r.expires_at ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async getMemory(id: string): Promise<Memory | undefined> {
    const row = this.store.db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as
      | {
          id: string;
          kind: string;
          scope: string;
          content: string;
          confidence: number;
          source: string | null;
          tags_json: string;
          expires_at: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      kind: row.kind as Memory["kind"],
      scope: row.scope as Memory["scope"],
      content: row.content,
      confidence: row.confidence,
      source: row.source ?? undefined,
      tags: jsonParse(row.tags_json, []),
      expiresAt: row.expires_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async saveMemory(memory: Memory): Promise<void> {
    this.store.db
      .prepare(
        `INSERT OR REPLACE INTO memories (id, kind, scope, content, confidence, source, tags_json, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        memory.id,
        memory.kind,
        memory.scope,
        memory.content,
        memory.confidence,
        memory.source ?? null,
        JSON.stringify(memory.tags ?? []),
        memory.expiresAt ?? null,
        memory.createdAt,
        memory.updatedAt
      );
  }

  async deleteMemory(id: string): Promise<void> {
    this.store.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  }

  async exportAll(): Promise<Record<string, Array<Record<string, unknown>>>> {
    const bundle: Record<string, Array<Record<string, unknown>>> = {};
    for (const table of EXPORT_TABLES) {
      const rows = this.store.db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
      bundle[table] = rows;
    }
    return bundle;
  }

  async importAll(bundle: Record<string, Array<Record<string, unknown>>>): Promise<number> {
    let count = 0;
    for (const table of EXPORT_TABLES) {
      const rows = bundle[table] ?? [];
      for (const row of rows) {
        const keys = Object.keys(row);
        if (keys.length === 0) continue;
        const columns = keys.join(", ");
        const placeholders = keys.map(() => "?").join(", ");
        const values = keys.map((key) => {
          const value = row[key];
          return value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint"
            ? value
            : JSON.stringify(value);
        });
        this.store.db
          .prepare(`INSERT OR REPLACE INTO ${table} (${columns}) VALUES (${placeholders})`)
          .run(...values);
        count++;
      }
    }
    return count;
  }

  async listAudit(limit = 100): Promise<AuditEvent[]> {
    const rows = this.store.db
      .prepare("SELECT * FROM audit ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Array<{
      id: string;
      type: string;
      task_id: string | null;
      agent_id: string | null;
      conversation_id: string | null;
      tool_id: string | null;
      detail_json: string | null;
      created_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      taskId: r.task_id ?? undefined,
      agentId: r.agent_id ?? undefined,
      conversationId: r.conversation_id ?? undefined,
      toolId: r.tool_id ?? undefined,
      detail: r.detail_json ? jsonParse(r.detail_json, {}) : undefined,
      createdAt: r.created_at,
    }));
  }
}

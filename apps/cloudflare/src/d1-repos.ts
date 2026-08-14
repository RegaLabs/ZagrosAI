import {
  defaultSettings,
  settingsSchema,
  type Agent,
  type Artifact,
  type Approval,
  type Attachment,
  type AuditEvent,
  type Conversation,
  type Credential,
  type Memory,
  type Message,
  type OAuthPending,
  type Routine,
  type RoutineRun,
  type Settings,
  type Task,
  type Worker,
} from "@zagros/domain";
import type { Repos } from "@zagros/runtime";

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

const SCHEMA_MIGRATIONS = [
  "ALTER TABLE tasks ADD COLUMN paused INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE agents ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '{\"denyTools\":[],\"approvalTools\":[]}'",
  "ALTER TABLE agents ADD COLUMN group_name TEXT",
];

interface ApprovalRow {
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

interface CredentialRow {
  id: string;
  provider: string;
  account: string;
  scopes_json: string;
  token_json: string;
  created_at: string;
  updated_at: string;
}

interface ArtifactRow {
  id: string;
  key: string;
  value: string;
  agent_id: string | null;
  conversation_id: string | null;
  created_at: string;
  updated_at: string;
}

interface RoutineRow {
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

interface RoutineRunRow {
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
}

interface MemoryRow {
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

interface PendingRow {
  state: string;
  provider: string;
  redirect_uri: string;
  verifier_encrypted: string;
  expires_at: string;
  created_at: string;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  model_json TEXT NOT NULL,
  permissions_json TEXT NOT NULL,
  group_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  agent_id TEXT,
  conversation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  attachments_json TEXT NOT NULL,
  tool_calls_json TEXT,
  tool_call_id TEXT,
  tool_name TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL,
  steps_json TEXT NOT NULL,
  error TEXT,
  model_calls INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  paused INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_conversation ON tasks(conversation_id, created_at);
CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  os TEXT NOT NULL,
  arch TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  models_json TEXT NOT NULL,
  harnesses_json TEXT NOT NULL,
  online INTEGER NOT NULL DEFAULT 0,
  connected_at TEXT,
  last_seen_at TEXT
);
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  path TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  conversation_id TEXT,
  tool_id TEXT NOT NULL,
  tool_args_json TEXT NOT NULL,
  risk TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approvals_task ON approvals(task_id);
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  account TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  token_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_pending (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  verifier_encrypted TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  scope TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence REAL NOT NULL,
  source TEXT,
  tags_json TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  trigger_json TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  skill TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  retry_json TEXT NOT NULL,
  worker_req_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_run_at TEXT,
  last_status TEXT,
  next_run_at TEXT
);
CREATE TABLE IF NOT EXISTS routine_runs (
  id TEXT PRIMARY KEY,
  routine_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT,
  error TEXT,
  test INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_routine_runs_routine ON routine_runs(routine_id, started_at);
CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  task_id TEXT,
  agent_id TEXT,
  conversation_id TEXT,
  tool_id TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit(created_at);
`;

interface AgentRow {
  id: string;
  name: string;
  system_prompt: string;
  model_json: string;
  permissions_json: string;
  group_name: string | null;
  created_at: string;
  updated_at: string;
}

interface ConversationRow {
  id: string;
  title: string;
  agent_id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
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
}

interface TaskRow {
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

interface WorkerRow {
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
}

interface UploadRow {
  id: string;
  name: string;
  kind: string;
  mime_type: string;
  size: number;
  path: string;
  url: string;
  created_at: string;
}

interface AuditRow {
  id: string;
  type: string;
  task_id: string | null;
  agent_id: string | null;
  conversation_id: string | null;
  tool_id: string | null;
  detail_json: string | null;
  created_at: string;
}

function jsonParse<T>(value: string | undefined, fallback: T): T {
  if (value === undefined || value === null || value === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export class D1Repos implements Repos {
  private schemaReady = false;

  constructor(private readonly db: D1Database) {}

  async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    for (const statement of SCHEMA_SQL.split(";")) {
      const singleLine = statement.replace(/\s+/g, " ").trim();
      if (singleLine.length > 0) {
        try {
          await this.db.prepare(singleLine).run();
        } catch {
          try {
            await this.db.exec(singleLine);
          } catch {
            // ignore table/index already exists error
          }
        }
      }
    }
    for (const migration of SCHEMA_MIGRATIONS) {
      try {
        await this.db.prepare(migration).run();
      } catch {
        // column already exists
      }
    }
    this.schemaReady = true;
  }

  async getSettings(): Promise<Settings> {
    await this.ensureSchema();
    const row = await this.db.prepare("SELECT value FROM settings WHERE key = ?").bind("main").first<{ value: string }>();
    const parsed = jsonParse<Settings>(row?.value, undefined as never);
    if (parsed === undefined) {
      const settings = { ...defaultSettings(), runnerToken: crypto.randomUUID().replace(/-/g, "") };
      await this.saveSettings(settings);
      return settings;
    }
    return settingsSchema.parse(parsed);
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.ensureSchema();
    await this.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind("main", JSON.stringify(settings)).run();
  }

  async listAgents(): Promise<Agent[]> {
    await this.ensureSchema();
    const { results } = await this.db.prepare("SELECT * FROM agents ORDER BY created_at").all<AgentRow>();
    return results.map((r) => this.mapAgent(r));
  }

  async getAgent(id: string): Promise<Agent | undefined> {
    await this.ensureSchema();
    const row = await this.db.prepare("SELECT * FROM agents WHERE id = ?").bind(id).first<AgentRow>();
    return row ? this.mapAgent(row) : undefined;
  }

  private mapAgent(row: AgentRow): Agent {
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
    await this.ensureSchema();
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO agents (id, name, system_prompt, model_json, permissions_json, group_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        agent.id,
        agent.name,
        agent.systemPrompt,
        JSON.stringify(agent.model),
        JSON.stringify(agent.permissions ?? { denyTools: [], approvalTools: [] }),
        agent.group ?? null,
        agent.createdAt,
        agent.updatedAt
      )
      .run();
  }

  async deleteAgent(id: string): Promise<void> {
    await this.ensureSchema();
    await this.db.prepare("DELETE FROM agents WHERE id = ?").bind(id).run();
  }

  async listConversations(): Promise<Conversation[]> {
    await this.ensureSchema();
    const { results } = await this.db.prepare("SELECT * FROM conversations ORDER BY updated_at DESC").all<ConversationRow>();
    return results.map((r) => ({
      id: r.id,
      title: r.title,
      agentId: r.agent_id,
      userId: r.user_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    await this.ensureSchema();
    const row = await this.db.prepare("SELECT * FROM conversations WHERE id = ?").bind(id).first<ConversationRow>();
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
    await this.ensureSchema();
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO conversations (id, title, agent_id, user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(conversation.id, conversation.title, conversation.agentId, conversation.userId, conversation.createdAt, conversation.updatedAt)
      .run();
  }

  async touchConversation(id: string, at: string): Promise<void> {
    await this.ensureSchema();
    await this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").bind(at, id).run();
  }

  async deleteConversation(id: string): Promise<void> {
    await this.ensureSchema();
    await this.db.prepare("DELETE FROM conversations WHERE id = ?").bind(id).run();
    await this.db.prepare("DELETE FROM messages WHERE conversation_id = ?").bind(id).run();
    await this.db.prepare("DELETE FROM tasks WHERE conversation_id = ?").bind(id).run();
  }

  async listMessages(conversationId: string, limit?: number): Promise<Message[]> {
    await this.ensureSchema();
    const { results } = limit
      ? await this.db
          .prepare("SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?) ORDER BY created_at ASC")
          .bind(conversationId, limit)
          .all<MessageRow>()
      : await this.db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC").bind(conversationId).all<MessageRow>();
    return results.map((r) => ({
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
    await this.ensureSchema();
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO messages (id, conversation_id, agent_id, role, content, attachments_json, tool_calls_json, tool_call_id, tool_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
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
      )
      .run();
  }

  async listTasks(limit = 100): Promise<Task[]> {
    await this.ensureSchema();
    const { results } = await this.db.prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?").bind(limit).all<TaskRow>();
    return results.map((r) => ({
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
    await this.ensureSchema();
    const row = await this.db.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first<TaskRow>();
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
    await this.ensureSchema();
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO tasks (id, conversation_id, message_id, agent_id, status, steps_json, error, model_calls, tool_calls, paused, created_at, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
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
      )
      .run();
  }

  async listWorkers(): Promise<Worker[]> {
    await this.ensureSchema();
    const { results } = await this.db.prepare("SELECT * FROM workers ORDER BY name").all<WorkerRow>();
    return results.map((r) => ({
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
    await this.ensureSchema();
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO workers (id, name, os, arch, capabilities_json, models_json, harnesses_json, online, connected_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
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
      )
      .run();
  }

  async saveUpload(attachment: Attachment): Promise<void> {
    await this.ensureSchema();
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO uploads (id, name, kind, mime_type, size, path, url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        attachment.id,
        attachment.name,
        attachment.kind,
        attachment.mimeType,
        attachment.size,
        attachment.path ?? "",
        attachment.url ?? "",
        attachment.createdAt
      )
      .run();
  }

  async getUpload(id: string): Promise<Attachment | undefined> {
    await this.ensureSchema();
    const row = await this.db.prepare("SELECT * FROM uploads WHERE id = ?").bind(id).first<UploadRow>();
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
    await this.ensureSchema();
    await this.db
      .prepare(
        `INSERT INTO audit (id, type, task_id, agent_id, conversation_id, tool_id, detail_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        event.id,
        event.type,
        event.taskId ?? null,
        event.agentId ?? null,
        event.conversationId ?? null,
        event.toolId ?? null,
        event.detail ? JSON.stringify(event.detail) : null,
        event.createdAt
      )
      .run();
  }

  async saveApproval(approval: Approval): Promise<void> {
    await this.ensureSchema();
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO approvals (id, task_id, step_id, conversation_id, tool_id, tool_args_json, risk, reason, status, created_at, decided_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
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
      )
      .run();
  }

  async getApproval(id: string): Promise<Approval | undefined> {
    await this.ensureSchema();
    const row = await this.db.prepare("SELECT * FROM approvals WHERE id = ?").bind(id).first<ApprovalRow>();
    return row ? this.mapApproval(row) : undefined;
  }

  async listApprovals(taskId?: string, limit = 50): Promise<Approval[]> {
    await this.ensureSchema();
    const { results } = taskId
      ? await this.db.prepare("SELECT * FROM approvals WHERE task_id = ? ORDER BY created_at DESC LIMIT ?").bind(taskId, limit).all<ApprovalRow>()
      : await this.db.prepare("SELECT * FROM approvals ORDER BY created_at DESC LIMIT ?").bind(limit).all<ApprovalRow>();
    return results.map((r) => this.mapApproval(r));
  }

  async updateApprovalStatus(id: string, status: Approval["status"], decidedAt?: string): Promise<void> {
    await this.ensureSchema();
    await this.db.prepare("UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?").bind(status, decidedAt ?? null, id).run();
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
    await this.ensureSchema();
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO credentials (id, provider, account, scopes_json, token_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        credential.id,
        credential.provider,
        credential.account,
        JSON.stringify(credential.scopes),
        credential.tokenJson,
        credential.createdAt,
        credential.updatedAt
      )
      .run();
  }

  async getCredential(id: string): Promise<Credential | undefined> {
    await this.ensureSchema();
    const row = await this.db.prepare("SELECT * FROM credentials WHERE id = ?").bind(id).first<CredentialRow>();
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
    await this.ensureSchema();
    const { results } = await this.db.prepare("SELECT * FROM credentials ORDER BY created_at").all<CredentialRow>();
    return results.map((r) => ({
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
    await this.ensureSchema();
    await this.db.prepare("DELETE FROM credentials WHERE id = ?").bind(id).run();
  }

  async savePendingAuth(pending: OAuthPending): Promise<void> {
    await this.ensureSchema();
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO oauth_pending (state, provider, redirect_uri, verifier_encrypted, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        pending.state,
        pending.provider,
        pending.redirectUri,
        pending.verifierEncrypted,
        pending.expiresAt,
        pending.createdAt
      )
      .run();
  }

  async getPendingAuth(state: string): Promise<OAuthPending | undefined> {
    await this.ensureSchema();
    const row = await this.db.prepare("SELECT * FROM oauth_pending WHERE state = ?").bind(state).first<PendingRow>();
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
    await this.ensureSchema();
    await this.db.prepare("DELETE FROM oauth_pending WHERE state = ?").bind(state).run();
  }

  async listRoutines(): Promise<Routine[]> {
    await this.ensureSchema();
    const { results } = await this.db.prepare("SELECT * FROM routines ORDER BY created_at").all<RoutineRow>();
    return results.map((r) => this.mapRoutine(r));
  }

  async getRoutine(id: string): Promise<Routine | undefined> {
    await this.ensureSchema();
    const row = await this.db.prepare("SELECT * FROM routines WHERE id = ?").bind(id).first<RoutineRow>();
    return row ? this.mapRoutine(row) : undefined;
  }

  async saveRoutine(routine: Routine): Promise<void> {
    await this.ensureSchema();
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO routines (id, name, description, trigger_json, agent_id, prompt, skill, enabled, retry_json, worker_req_json, created_at, updated_at, last_run_at, last_status, next_run_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
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
      )
      .run();
  }

  async deleteRoutine(id: string): Promise<void> {
    await this.ensureSchema();
    await this.db.prepare("DELETE FROM routines WHERE id = ?").bind(id).run();
    await this.db.prepare("DELETE FROM routine_runs WHERE routine_id = ?").bind(id).run();
  }

  async listRoutineRuns(routineId?: string, limit = 50): Promise<RoutineRun[]> {
    await this.ensureSchema();
    const { results } = routineId
      ? await this.db.prepare("SELECT * FROM routine_runs WHERE routine_id = ? ORDER BY started_at DESC LIMIT ?").bind(routineId, limit).all<RoutineRunRow>()
      : await this.db.prepare("SELECT * FROM routine_runs ORDER BY started_at DESC LIMIT ?").bind(limit).all<RoutineRunRow>();
    return results.map((r) => ({
      id: r.id,
      routineId: r.routine_id,
      taskId: r.task_id,
      status: r.status as RoutineRun["status"],
      attempts: r.attempts,
      payload: jsonParse(r.payload_json ?? undefined, undefined),
      error: r.error ?? undefined,
      test: r.test === 1,
      startedAt: r.started_at,
      finishedAt: r.finished_at ?? undefined,
    }));
  }

  async saveRoutineRun(run: RoutineRun): Promise<void> {
    await this.ensureSchema();
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO routine_runs (id, routine_id, task_id, status, attempts, payload_json, error, test, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
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
      )
      .run();
  }

  private mapRoutine(row: RoutineRow): Routine {
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

  async getArtifact(key: string): Promise<Artifact | undefined> {
    await this.ensureSchema();
    const row = await this.db.prepare("SELECT * FROM artifacts WHERE key = ?").bind(key).first<ArtifactRow>();
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
    await this.ensureSchema();
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO artifacts (id, key, value, agent_id, conversation_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        artifact.id,
        artifact.key ?? artifact.id,
        artifact.value ?? "",
        artifact.agentId ?? null,
        artifact.conversationId ?? null,
        artifact.createdAt,
        artifact.updatedAt
      )
      .run();
  }

  async listArtifacts(limit = 100): Promise<Artifact[]> {
    await this.ensureSchema();
    const { results } = await this.db.prepare("SELECT * FROM artifacts ORDER BY updated_at DESC LIMIT ?").bind(limit).all<ArtifactRow>();
    return results.map((r) => ({
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
    await this.ensureSchema();
    const { results } = await this.db.prepare("SELECT * FROM memories ORDER BY updated_at DESC LIMIT ?").bind(limit).all<MemoryRow>();
    return results.map((r) => this.mapMemory(r));
  }

  async getMemory(id: string): Promise<Memory | undefined> {
    await this.ensureSchema();
    const row = await this.db.prepare("SELECT * FROM memories WHERE id = ?").bind(id).first<MemoryRow>();
    return row ? this.mapMemory(row) : undefined;
  }

  async saveMemory(memory: Memory): Promise<void> {
    await this.ensureSchema();
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO memories (id, kind, scope, content, confidence, source, tags_json, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
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
      )
      .run();
  }

  async deleteMemory(id: string): Promise<void> {
    await this.ensureSchema();
    await this.db.prepare("DELETE FROM memories WHERE id = ?").bind(id).run();
  }

  private mapMemory(row: MemoryRow): Memory {
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

  async exportAll(): Promise<Record<string, Array<Record<string, unknown>>>> {
    await this.ensureSchema();
    const bundle: Record<string, Array<Record<string, unknown>>> = {};
    for (const table of EXPORT_TABLES) {
      const { results } = await this.db.prepare(`SELECT * FROM ${table}`).all<Record<string, unknown>>();
      bundle[table] = results;
    }
    return bundle;
  }

  async importAll(bundle: Record<string, Array<Record<string, unknown>>>): Promise<number> {
    await this.ensureSchema();
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
          if (value === null || typeof value === "string" || typeof value === "number") {
            return value;
          }
          if (typeof value === "boolean") {
            return value ? 1 : 0;
          }
          return JSON.stringify(value);
        });
        await this.db
          .prepare(`INSERT OR REPLACE INTO ${table} (${columns}) VALUES (${placeholders})`)
          .bind(...values)
          .run();
        count++;
      }
    }
    return count;
  }

  async listAudit(limit = 100): Promise<AuditEvent[]> {
    await this.ensureSchema();
    const { results } = await this.db.prepare("SELECT * FROM audit ORDER BY created_at DESC LIMIT ?").bind(limit).all<AuditRow>();
    return results.map((r) => ({
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

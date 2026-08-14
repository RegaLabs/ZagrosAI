import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class Store {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      throw err;
    }
  }

  private migrate(): void {
    this.db.exec(`
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
    `);
    this.migrateMigrations();
  }

  private migrateMigrations(): void {
    const migrations = [
      "ALTER TABLE tasks ADD COLUMN paused INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE agents ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '{\"denyTools\":[],\"approvalTools\":[]}'",
      "ALTER TABLE agents ADD COLUMN group_name TEXT",
    ];
    for (const migration of migrations) {
      try {
        this.db.exec(migration);
      } catch {
        // column already exists
      }
    }
  }
}

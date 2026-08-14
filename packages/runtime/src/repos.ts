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

export interface IRepos {
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;

  listAgents(): Promise<Agent[]>;
  getAgent(id: string): Promise<Agent | undefined>;
  saveAgent(agent: Agent): Promise<void>;
  deleteAgent(id: string): Promise<void>;

  listConversations(): Promise<Conversation[]>;
  getConversation(id: string): Promise<Conversation | undefined>;
  saveConversation(conversation: Conversation): Promise<void>;
  touchConversation(id: string, at: string): Promise<void>;
  deleteConversation(id: string): Promise<void>;

  listMessages(conversationId: string, limit?: number): Promise<Message[]>;
  saveMessage(message: Message): Promise<void>;

  listTasks(limit?: number): Promise<Task[]>;
  getTask(id: string): Promise<Task | undefined>;
  saveTask(task: Task): Promise<void>;

  listWorkers(): Promise<Worker[]>;
  saveWorker(worker: Worker): Promise<void>;

  saveUpload(attachment: Attachment): Promise<void>;
  getUpload(id: string): Promise<Attachment | undefined>;

  saveApproval(approval: Approval): Promise<void>;
  getApproval(id: string): Promise<Approval | undefined>;
  listApprovals(taskId?: string, limit?: number): Promise<Approval[]>;
  updateApprovalStatus(id: string, status: Approval["status"], decidedAt?: string): Promise<void>;

  saveCredential(credential: Credential): Promise<void>;
  getCredential(id: string): Promise<Credential | undefined>;
  listCredentials(): Promise<Credential[]>;
  deleteCredential(id: string): Promise<void>;

  savePendingAuth(pending: OAuthPending): Promise<void>;
  getPendingAuth(state: string): Promise<OAuthPending | undefined>;
  deletePendingAuth(state: string): Promise<void>;

  listMemories(limit?: number): Promise<Memory[]>;
  getMemory(id: string): Promise<Memory | undefined>;
  saveMemory(memory: Memory): Promise<void>;
  deleteMemory(id: string): Promise<void>;

  listRoutines(): Promise<Routine[]>;
  getRoutine(id: string): Promise<Routine | undefined>;
  saveRoutine(routine: Routine): Promise<void>;
  deleteRoutine(id: string): Promise<void>;
  listRoutineRuns(routineId?: string, limit?: number): Promise<RoutineRun[]>;
  saveRoutineRun(run: RoutineRun): Promise<void>;

  getArtifact(key: string): Promise<Artifact | undefined>;
  saveArtifact(artifact: Artifact): Promise<void>;
  listArtifacts(limit?: number): Promise<Artifact[]>;

  appendAudit(event: AuditEvent): Promise<void>;
  listAudit(limit?: number): Promise<AuditEvent[]>;
  exportAll(): Promise<Record<string, Array<Record<string, unknown>>>>;
  importAll(bundle: Record<string, Array<Record<string, unknown>>>): Promise<number>;
}

export type Repos = IRepos;

export type ModelDriver =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "openrouter"
  | "cloudflare"
  | "ollama"
  | "vllm"
  | "lmstudio"
  | "openai-compatible"
  | "acp";

export interface ModelConfig {
  driver: ModelDriver;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  temperature: number;
  imageInput: boolean;
  harness?: string;
  fallback?: ModelFallbackConfig[];
}

export interface ModelFallbackConfig {
  driver: ModelDriver;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
  imageInput?: boolean;
}

export interface AgentPermissions {
  denyTools: string[];
  approvalTools: string[];
}

export interface Agent {
  id: string;
  name: string;
  systemPrompt: string;
  model: ModelConfig;
  permissions: AgentPermissions;
  group?: string;
  createdAt: string;
  updatedAt: string;
}

export type AttachmentKind = "image" | "video" | "audio" | "document" | "code" | "file";

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  url?: string;
  path?: string;
  createdAt: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface Message {
  id: string;
  conversationId: string;
  agentId: string;
  role: MessageRole;
  content: string;
  attachments: Attachment[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  agentId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationSummary extends Conversation {
  agentName: string;
  lastMessage?: string;
  lastMessageAt: string;
}

export type TaskStatus =
  | "queued"
  | "running"
  | "waiting_for_tool"
  | "waiting_for_approval"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired"
  | "blocked";

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type StepKind = "model" | "tool" | "verify";

export interface TaskStep {
  id: string;
  taskId: string;
  kind: StepKind;
  objective?: string;
  toolId?: string;
  toolArgs?: Record<string, unknown>;
  workerId?: string;
  status: StepStatus;
  result?: unknown;
  error?: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  conversationId: string;
  messageId: string;
  agentId: string;
  status: TaskStatus;
  paused: boolean;
  steps: TaskStep[];
  error?: string;
  modelCalls: number;
  toolCalls: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface BrowserSession {
  id: string;
  url: string;
  title: string;
  createdAt: string;
  lastActiveAt: string;
}

export interface ExecutorToolResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
  workerId?: string;
}

export interface FilesEntry {
  name: string;
  type: "directory" | "file";
  size: number;
}

export interface WorkerCapabilities {
  shell: boolean;
  filesystem: boolean;
  browser: boolean;
  docker: boolean;
  gpu: boolean;
}

export interface Worker {
  id: string;
  name: string;
  os: string;
  arch: string;
  capabilities: WorkerCapabilities;
  models: string[];
  harnesses: string[];
  online: boolean;
  connectedAt?: string;
  lastSeenAt?: string;
}

export type McpTransport = "stdio" | "http";

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
  url?: string;
}

export interface Settings {
  defaultModel: ModelConfig;
  mcpServers: McpServerConfig[];
  runnerToken?: string;
  runnerWhitelist: string[];
}

export interface AuditEvent {
  id: string;
  type: string;
  taskId?: string;
  agentId?: string;
  conversationId?: string;
  toolId?: string;
  detail?: Record<string, unknown>;
  createdAt: string;
}

export type ToolProvider = "native" | "runner" | "mcp";
export type ToolRisk = "R0" | "R1" | "R2" | "R3";

export interface ToolInfo {
  id: string;
  provider: ToolProvider;
  description: string;
  risk: ToolRisk;
}

export interface HealthInfo {
  ok: boolean;
  name: string;
  version: string;
  uptimeSeconds: number;
}

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface Approval {
  id: string;
  taskId: string;
  stepId: string;
  conversationId?: string;
  toolId: string;
  toolArgs: Record<string, unknown>;
  risk: ToolRisk;
  reason?: string;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt?: string;
  expiresAt: string;
}

export interface ConnectorView {
  id: string;
  provider: string;
  providerLabel: string;
  account: string;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorConnectedInfo {
  id: string;
  provider: string;
  account: string;
  scopes: string[];
  createdAt: string;
}

export interface OAuthProviderInfo {
  id: string;
  label: string;
  scopes: string[];
}

export type McpOauthStatus = "connected" | "awaiting" | "error";

export interface McpOauthInfo {
  status: McpOauthStatus;
  authorizationUrl?: string;
  error?: string;
}

export interface McpServerStatus {
  id: string;
  name: string;
  transport: McpTransport;
  url?: string;
  oauth?: McpOauthInfo;
}

export interface SendMessageResponse {
  message: Message;
  task: Task;
}

export interface UploadResponse {
  attachmentId: string;
  kind: AttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  url: string;
}

export interface ConversationDetail {
  conversation: Conversation;
  messages: Message[];
}

export interface ServerHello {
  type: "hello";
  server: { name: "zagros"; version: string };
  state: {
    agents: Agent[];
    conversations: ConversationSummary[];
    tasks: Task[];
    workers: Worker[];
    settings: Settings;
  };
}

export interface ConversationCreatedEvent {
  type: "conversation.created";
  conversation: Conversation;
}

export interface MessageDeltaEvent {
  type: "message.delta";
  conversationId: string;
  messageId: string;
  delta: string;
}

export interface MessageCompletedEvent {
  type: "message.completed";
  conversationId: string;
  message: Message;
}

export interface TaskCreatedEvent {
  type: "task.created";
  task: Task;
}

export interface TaskUpdatedEvent {
  type: "task.updated";
  task: Task;
}

export interface StepStartedEvent {
  type: "step.started";
  taskId: string;
  step: TaskStep;
}

export interface ToolStartedEvent {
  type: "tool.started";
  taskId: string;
  stepId: string;
  toolId: string;
  args: Record<string, unknown>;
  workerId?: string;
}

export interface ToolCompletedEvent {
  type: "tool.completed";
  taskId: string;
  stepId: string;
  toolId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface WorkerOnlineEvent {
  type: "worker.online";
  worker: Worker;
}

export interface WorkerOfflineEvent {
  type: "worker.offline";
  worker: Worker;
}

export interface SettingsUpdatedEvent {
  type: "settings.updated";
  settings: Settings;
}

export interface ApprovalRequestedEvent {
  type: "approval.requested";
  approval: Approval;
}

export interface ApprovalDecidedEvent {
  type: "approval.decided";
  approval: Approval;
}

export interface ConnectorConnectedEvent {
  type: "connector.connected";
  connector: ConnectorConnectedInfo;
}

export interface ConnectorRemovedEvent {
  type: "connector.removed";
  connectorId: string;
}

export type RoutineMissedRuns = "skip" | "run_latest" | "backfill";

export interface RoutineScheduleTrigger {
  type: "schedule";
  cron: string;
  missedRuns?: RoutineMissedRuns;
}

export interface RoutineWebhookTrigger {
  type: "webhook";
  path: string;
}

export interface RoutineManualTrigger {
  type: "manual";
}

export type RoutineTrigger =
  | RoutineScheduleTrigger
  | RoutineWebhookTrigger
  | RoutineManualTrigger;

export interface RoutineRetry {
  attempts: number;
  backoffMs: number;
  deadLetter: boolean;
}

export interface RoutineWorkerRequirements {
  capabilities: string[];
  harnesses: string[];
}

export type RoutineLastStatus = "completed" | "failed" | "deadletter" | "unmet";

export interface Routine {
  id: string;
  name: string;
  description?: string;
  trigger: RoutineTrigger;
  agentId: string;
  prompt: string;
  skill?: string;
  enabled: boolean;
  retry: RoutineRetry;
  workerRequirements: RoutineWorkerRequirements;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastStatus?: RoutineLastStatus;
  nextRunAt?: string;
}

export type RoutineRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "deadletter"
  | "unmet";

export interface RoutineRun {
  id: string;
  routineId: string;
  taskId: string;
  status: RoutineRunStatus;
  attempts: number;
  payload?: unknown;
  error?: string;
  test: boolean;
  startedAt?: string;
  finishedAt?: string;
}

export interface CreateRoutineInput {
  name: string;
  description?: string;
  trigger: RoutineTrigger;
  agentId: string;
  prompt: string;
  skill?: string;
  enabled?: boolean;
  retry?: RoutineRetry;
  workerRequirements?: RoutineWorkerRequirements;
}

export interface RoutineRunEvent {
  type: "routine.run";
  routineId: string;
  run: RoutineRun;
}

export type ServerEvent =
  | ServerHello
  | ConversationCreatedEvent
  | MessageDeltaEvent
  | MessageCompletedEvent
  | TaskCreatedEvent
  | TaskUpdatedEvent
  | StepStartedEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | WorkerOnlineEvent
  | WorkerOfflineEvent
  | SettingsUpdatedEvent
  | ApprovalRequestedEvent
  | ApprovalDecidedEvent
  | ConnectorConnectedEvent
  | ConnectorRemovedEvent
  | RoutineRunEvent;

export interface StreamingBuffer {
  messageId: string;
  text: string;
}

export type MemoryKind = "episodic" | "semantic" | "procedural";
export type MemoryScope = "global" | "agent" | "project";

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  scope: MemoryScope;
  content: string;
  confidence: number;
  source?: string;
  tags: string[];
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMemoryInput {
  content: string;
  kind?: MemoryKind;
  scope?: MemoryScope;
  confidence?: number;
  expiresAt?: string;
}

export interface PatchMemoryInput {
  content?: string;
  confidence?: number;
  expiresAt?: string;
}

export interface SkillRequires {
  tools: string[];
  capabilities: string[];
}

export interface SkillSummary {
  name: string;
  version: string;
  description: string;
  requires: SkillRequires;
  approval: Record<string, string>;
  verification: string[];
  tests: string[];
  permissions: { secrets: boolean };
  tags: string[];
  source: string;
}

export interface SkillDetail extends SkillSummary {
  readme: string;
}

export interface SkillTestResult {
  test: string;
  ok: boolean;
  output: string;
  error?: string;
}

export interface A2aAgentInfo {
  agentId: string;
  name: string;
  cardUrl: string;
  jsonrpcUrl: string;
}

export interface Artifact {
  id: string;
  key: string;
  value: unknown;
  agentId?: string;
  conversationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SecurityStatus {
  masterKeyConfigured: boolean;
  skillVerificationEnabled: boolean;
  rateLimitPerMinute: number;
  maxConcurrentTasks: number;
  auditHashing: boolean;
  runnerCount: number;
  harnesses: string[];
  recentAuditEvents: number;
  version: string;
}

export interface DepsScanSummary {
  total: number;
  critical: number;
  high: number;
  moderate: number;
  low: number;
}

export type DepsScanResponse =
  | { ok: true; summary: DepsScanSummary }
  | { ok: false; error: string };

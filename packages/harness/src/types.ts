import type { Agent, Conversation, Message, Task, Attachment, ModelConfig, TaskStep } from "@zagros/domain";
import type { ModelDriver, ModelRegistry, ModelToolCall } from "@zagros/models";
import type { ToolDefinition, ToolRegistry } from "@zagros/tools";
import type { EventBus } from "@zagros/protocol";

export type ApprovalDecision = "approved" | "rejected" | "expired";

export interface ApprovalRequest {
  task: Task;
  step: TaskStep;
  call: ModelToolCall;
  tool: ToolDefinition;
  signal?: AbortSignal;
}

export interface SkillMatch {
  name: string;
  description: string;
  content: string;
  score: number;
}

export interface MemoryCandidate {
  content: string;
  kind: "episodic" | "semantic" | "procedural";
  scope: "global" | "agent" | "project";
  confidence: number;
  source?: string;
  expiresAt?: string;
}

export interface MemoryRecord {
  content: string;
  kind: "episodic" | "semantic" | "procedural";
  scope: "global" | "agent" | "project";
  confidence: number;
  source?: string;
  expiresAt?: string;
}

export interface MemoryHooks {
  search(query: string, opts?: { limit?: number }): Promise<MemoryRecord[]>;
  propose(candidate: MemoryCandidate): Promise<void>;
  extract?(opts: { agent: Agent; conversation: Conversation; transcript: string }): Promise<void>;
}

export interface SkillHooks {
  discover(text: string): Promise<SkillMatch[]>;
}

export interface HarnessPersistence {
  getMessages(conversationId: string, limit?: number): Promise<Message[]>;
  saveMessage(message: Message): Promise<void>;
  createTask(task: Task): Promise<Task>;
  updateTask(task: Task): Promise<Task>;
  getTask(id: string): Promise<Task | undefined>;
}

export interface AttachmentResolver {
  (attachment: Attachment): Promise<{ data: string; mimeType?: string } | undefined>;
}

export interface HarnessDeps {
  models: ModelRegistry;
  tools: ToolRegistry;
  events: EventBus;
  persist: HarnessPersistence;
  workspaceDir: string;
  resolveAttachment?: AttachmentResolver;
  resolveModel?: (config: ModelConfig) => ModelDriver | undefined;
  requestApproval?: (request: ApprovalRequest) => Promise<ApprovalDecision>;
  shouldPause?: (taskId: string) => boolean;
  scrubSecrets?: (text: string) => string;
  skills?: SkillHooks;
  memory?: MemoryHooks;
  timeoutMs?: number;
  maxIterations?: number;
  maxHistoryMessages?: number;
}

export interface HarnessRunInput {
  agent: Agent;
  conversation: Conversation;
  userMessage: Message;
  task: Task;
  signal?: AbortSignal;
}

export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_ITERATIONS = 20;
export const DEFAULT_MAX_HISTORY = 40;

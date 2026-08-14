import { z } from "zod";
import { idSchema, timestampSchema } from "./ids.js";

export const modelDriverIdSchema = z.enum([
  "openai",
  "anthropic",
  "google",
  "xai",
  "openrouter",
  "cloudflare",
  "ollama",
  "vllm",
  "lmstudio",
  "openai-compatible",
  "acp",
]);
export type ModelDriverId = z.infer<typeof modelDriverIdSchema>;

const modelConfigBaseSchema = z.object({
  driver: modelDriverIdSchema,
  model: z.string().min(1),
  baseUrl: z.string().url().or(z.literal("")).optional(),
  apiKey: z.string().optional(),
  temperature: z.number().min(0).max(2).default(0.7),
  imageInput: z.boolean().default(true),
  harness: z.string().optional(),
});

export const modelConfigSchema = modelConfigBaseSchema.extend({
  fallback: z.lazy(() => modelConfigBaseSchema.array()).optional(),
});
export type ModelConfig = z.infer<typeof modelConfigSchema>;

export const userSchema = z.object({
  id: idSchema,
  displayName: z.string().min(1),
  createdAt: timestampSchema,
});
export type User = z.infer<typeof userSchema>;

export const agentSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(80),
  systemPrompt: z.string().default("You are a helpful, honest agent."),
  model: modelConfigSchema,
  permissions: z
    .object({
      denyTools: z.array(z.string()).default([]),
      approvalTools: z.array(z.string()).default([]),
    })
    .default({}),
  group: z.string().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Agent = z.infer<typeof agentSchema>;

export const artifactSchema = z.object({
  id: idSchema,
  key: z.string().min(1).max(200).optional(),
  value: z.string().optional(),
  name: z.string().optional(),
  mimeType: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  hash: z.string().optional(),
  creator: z.string().optional(),
  taskId: idSchema.optional(),
  stepId: idSchema.optional(),
  provenance: z.record(z.unknown()).optional(),
  url: z.string().optional(),
  storagePath: z.string().optional(),
  agentId: idSchema.optional(),
  conversationId: idSchema.optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Artifact = z.infer<typeof artifactSchema>;

export const attachmentKindSchema = z.enum([
  "image",
  "video",
  "audio",
  "document",
  "code",
  "file",
]);
export type AttachmentKind = z.infer<typeof attachmentKindSchema>;

export const attachmentSchema = z.object({
  id: idSchema,
  kind: attachmentKindSchema,
  name: z.string().min(1),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  url: z.string().optional(),
  path: z.string().optional(),
  createdAt: timestampSchema,
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const toolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.record(z.unknown()).default({}),
});
export type ToolCall = z.infer<typeof toolCallSchema>;

export const messageRoleSchema = z.enum(["user", "assistant", "system", "tool"]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const messageSchema = z.object({
  id: idSchema,
  conversationId: idSchema,
  agentId: idSchema,
  role: messageRoleSchema,
  content: z.string().default(""),
  attachments: z.array(attachmentSchema).default([]),
  toolCalls: z.array(toolCallSchema).optional(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  createdAt: timestampSchema,
});
export type Message = z.infer<typeof messageSchema>;

export const conversationSchema = z.object({
  id: idSchema,
  title: z.string().default("New conversation"),
  agentId: idSchema,
  userId: idSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Conversation = z.infer<typeof conversationSchema>;

export const executionRequirementsSchema = z.object({
  edge: z.boolean().default(false),
  browser: z.boolean().default(false),
  sandbox: z.boolean().default(false),
  shell: z.boolean().default(false),
  filesystem: z.boolean().default(false),
  docker: z.boolean().default(false),
  gpu: z.boolean().default(false),
  model: z.string().optional(),
  harness: z.string().optional(),
});
export type ExecutionRequirements = z.infer<typeof executionRequirementsSchema>;

export const taskStatusSchema = z.enum([
  "queued",
  "planning",
  "running",
  "waiting_for_tool",
  "waiting_for_approval",
  "waiting_for_worker",
  "verifying",
  "completed",
  "failed",
  "cancelled",
  "expired",
  "blocked",
]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const stepStatusSchema = z.enum([
  "pending",
  "running",
  "waiting_for_approval",
  "waiting_for_worker",
  "completed",
  "failed",
  "skipped",
]);
export type StepStatus = z.infer<typeof stepStatusSchema>;

export const stepKindSchema = z.enum(["model", "tool", "verify"]);
export type StepKind = z.infer<typeof stepKindSchema>;

export const taskStepSchema = z.object({
  id: idSchema,
  taskId: idSchema,
  kind: stepKindSchema,
  objective: z.string().optional(),
  dependencies: z.array(idSchema).default([]),
  requirements: executionRequirementsSchema.optional(),
  toolId: z.string().optional(),
  toolArgs: z.record(z.unknown()).optional(),
  workerId: z.string().optional(),
  status: stepStatusSchema,
  result: z.unknown().optional(),
  error: z.string().optional(),
  attempts: z.number().int().nonnegative().default(0),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type TaskStep = z.infer<typeof taskStepSchema>;

export const taskSchema = z.object({
  id: idSchema,
  conversationId: idSchema,
  messageId: idSchema,
  agentId: idSchema,
  status: taskStatusSchema,
  steps: z.array(taskStepSchema).default([]),
  error: z.string().optional(),
  modelCalls: z.number().int().nonnegative().default(0),
  toolCalls: z.number().int().nonnegative().default(0),
  paused: z.boolean().default(false),
  parentTaskId: idSchema.optional(),
  subtaskIds: z.array(idSchema).optional(),
  createdAt: timestampSchema,
  startedAt: timestampSchema.optional(),
  completedAt: timestampSchema.optional(),
});
export type Task = z.infer<typeof taskSchema>;

export const workerCapabilitiesSchema = z.object({
  shell: z.boolean().default(false),
  filesystem: z.boolean().default(false),
  browser: z.boolean().default(false),
  docker: z.boolean().default(false),
  gpu: z.boolean().default(false),
});
export type WorkerCapabilities = z.infer<typeof workerCapabilitiesSchema>;

export const workerSchema = z.object({
  id: idSchema,
  name: z.string().default("unnamed"),
  os: z.string(),
  arch: z.string(),
  capabilities: workerCapabilitiesSchema,
  models: z.array(z.string()).default([]),
  harnesses: z.array(z.string()).default([]),
  online: z.boolean().default(false),
  connectedAt: timestampSchema.optional(),
  lastSeenAt: timestampSchema.optional(),
});
export type Worker = z.infer<typeof workerSchema>;

export const auditEventSchema = z.object({
  id: idSchema,
  type: z.string().min(1),
  taskId: idSchema.optional(),
  agentId: idSchema.optional(),
  conversationId: idSchema.optional(),
  toolId: z.string().optional(),
  detail: z.record(z.unknown()).optional(),
  createdAt: timestampSchema,
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const mcpTransportSchema = z.enum(["stdio", "http"]);
export type McpTransport = z.infer<typeof mcpTransportSchema>;

export const mcpServerConfigSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  transport: mcpTransportSchema,
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  env: z.record(z.string()).default({}),
  url: z.string().url().optional(),
  oauth: z
    .object({
      clientId: z.string().optional(),
      scopes: z.array(z.string()).default([]),
    })
    .optional(),
});
export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;

export const settingsSchema = z.object({
  defaultModel: modelConfigSchema,
  mcpServers: z.array(mcpServerConfigSchema).default([]),
  runnerToken: z.string().optional(),
  runnerWhitelist: z.array(z.string()).default([]),
  offline: z
    .object({
      unavailableModel: z.enum(["fallback", "pause"]).default("fallback"),
    })
    .default({}),
  policy: z
    .object({
      blockedDomains: z.array(z.string()).default([]),
      allowedDomains: z.array(z.string()).default([]),
    })
    .default({}),
});
export type Settings = z.infer<typeof settingsSchema>;

export function defaultSettings(): Settings {
  return {
    defaultModel: {
      driver: "ollama",
      model: "qwen2.5:7b",
      baseUrl: "http://localhost:11434/v1",
      temperature: 0.7,
      imageInput: true,
    },
    mcpServers: [],
    runnerWhitelist: [],
    offline: { unavailableModel: "fallback" },
    policy: { blockedDomains: [], allowedDomains: [] },
  };
}

export const riskLevelSchema = z.enum(["R0", "R1", "R2", "R3"]);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

export const approvalStatusSchema = z.enum(["pending", "approved", "rejected", "expired"]);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const approvalSchema = z.object({
  id: idSchema,
  taskId: idSchema,
  stepId: idSchema,
  conversationId: idSchema.optional(),
  toolId: z.string(),
  toolArgs: z.record(z.unknown()).default({}),
  risk: riskLevelSchema,
  reason: z.string().optional(),
  status: approvalStatusSchema,
  createdAt: timestampSchema,
  decidedAt: timestampSchema.optional(),
  expiresAt: timestampSchema,
});
export type Approval = z.infer<typeof approvalSchema>;

export const credentialSchema = z.object({
  id: idSchema,
  provider: z.string().min(1),
  account: z.string().min(1),
  scopes: z.array(z.string()).default([]),
  tokenJson: z.string(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Credential = z.infer<typeof credentialSchema>;

export const oauthPendingSchema = z.object({
  state: z.string().min(1),
  provider: z.string().min(1),
  redirectUri: z.string().min(1),
  verifierEncrypted: z.string(),
  expiresAt: timestampSchema,
  createdAt: timestampSchema,
});
export type OAuthPending = z.infer<typeof oauthPendingSchema>;

export const memoryKindSchema = z.enum(["episodic", "semantic", "procedural"]);
export type MemoryKind = z.infer<typeof memoryKindSchema>;

export const memoryScopeSchema = z.enum(["global", "agent", "project"]);
export type MemoryScope = z.infer<typeof memoryScopeSchema>;

export const memorySchema = z.object({
  id: idSchema,
  kind: memoryKindSchema,
  scope: memoryScopeSchema.default("agent"),
  content: z.string().min(1).max(4000),
  confidence: z.number().min(0).max(1).default(0.7),
  source: z.string().optional(),
  tags: z.array(z.string()).default([]),
  expiresAt: timestampSchema.optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Memory = z.infer<typeof memorySchema>;

export const skillCapabilitySchema = z.enum(["shell", "filesystem", "browser", "docker", "gpu"]);

const nullToEmptyObj = (val: unknown) => (val === null || val === undefined ? {} : val);

export const skillManifestSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  version: z.string().default("1.0.0"),
  description: z.string().min(1),
  requires: z.preprocess(
    nullToEmptyObj,
    z
      .object({
        tools: z.array(z.string()).default([]),
        capabilities: z.array(skillCapabilitySchema).default([]),
      })
      .default({})
  ),
  approval: z.preprocess(nullToEmptyObj, z.record(z.enum(["required", "optional", "denied"])).default({})),
  verification: z.array(z.string()).default([]),
  tests: z
    .array(z.union([z.string(), z.record(z.unknown())]))
    .default([])
    .transform((items) => items.map((item) => (typeof item === "string" ? item : JSON.stringify(item)))),
  permissions: z.preprocess(
    nullToEmptyObj,
    z
      .object({
        secrets: z.boolean().default(false),
      })
      .default({})
  ),
  tags: z.array(z.string()).default([]),
  signature: z
    .object({
      algorithm: z.enum(["ECDSA-P256"]),
      keyId: z.string(),
      value: z.string(),
    })
    .optional(),
});
export type SkillManifest = z.infer<typeof skillManifestSchema>;

export const skillSummarySchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  requires: z.object({
    tools: z.array(z.string()),
    capabilities: z.array(skillCapabilitySchema),
  }),
  approval: z.record(z.enum(["required", "optional", "denied"])),
  verification: z.array(z.string()),
  tests: z.array(z.string()),
  permissions: z.object({ secrets: z.boolean() }),
  tags: z.array(z.string()),
  source: z.string(),
  trusted: z.boolean(),
});
export type SkillSummary = z.infer<typeof skillSummarySchema>;

export const routineTriggerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("schedule"),
    cron: z.string().min(1),
    missedRuns: z.enum(["skip", "run_latest", "backfill"]).default("run_latest"),
  }),
  z.object({
    type: z.literal("webhook"),
    path: z.string().regex(/^[a-z0-9][a-z0-9-_]*$/i),
  }),
  z.object({
    type: z.literal("event"),
    eventName: z.string().min(1),
  }),
  z.object({ type: z.literal("manual") }),
]);
export type RoutineTrigger = z.infer<typeof routineTriggerSchema>;

export const routineSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(80),
  description: z.string().default(""),
  trigger: routineTriggerSchema,
  agentId: idSchema,
  prompt: z.string().min(1).max(4000),
  skill: z.string().optional(),
  enabled: z.boolean().default(true),
  retry: z
    .object({
      attempts: z.number().int().min(0).max(5).default(1),
      backoffMs: z.number().int().min(0).max(600000).default(5000),
      deadLetter: z.boolean().default(true),
    })
    .default({}),
  workerRequirements: z
    .object({
      capabilities: z.array(skillCapabilitySchema).default([]),
      harnesses: z.array(z.string()).default([]),
    })
    .default({}),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  lastRunAt: timestampSchema.optional(),
  lastStatus: z.enum(["completed", "failed", "deadletter", "unmet"]).optional(),
  nextRunAt: timestampSchema.optional(),
});
export type Routine = z.infer<typeof routineSchema>;

export const routineRunStatusSchema = z.enum(["queued", "running", "completed", "failed", "deadletter", "unmet"]);
export type RoutineRunStatus = z.infer<typeof routineRunStatusSchema>;

export const routineRunSchema = z.object({
  id: idSchema,
  routineId: idSchema,
  taskId: idSchema,
  status: routineRunStatusSchema,
  attempts: z.number().int().nonnegative().default(0),
  payload: z.record(z.unknown()).optional(),
  error: z.string().optional(),
  test: z.boolean().default(false),
  startedAt: timestampSchema,
  finishedAt: timestampSchema.optional(),
});
export type RoutineRun = z.infer<typeof routineRunSchema>;

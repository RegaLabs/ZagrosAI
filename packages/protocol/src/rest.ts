import { z } from "zod";
import { attachmentKindSchema, modelConfigSchema } from "@zagros/domain";

export const createAgentRequestSchema = z.object({
  name: z.string().min(1).max(80),
  systemPrompt: z.string().default("You are a helpful, honest agent."),
  model: modelConfigSchema.optional(),
  permissions: z
    .object({
      denyTools: z.array(z.string()).default([]),
      approvalTools: z.array(z.string()).default([]),
    })
    .optional(),
  group: z.string().optional(),
});
export type CreateAgentRequest = z.infer<typeof createAgentRequestSchema>;

export const updateAgentRequestSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  systemPrompt: z.string().optional(),
  model: modelConfigSchema.optional(),
  permissions: z
    .object({
      denyTools: z.array(z.string()).default([]),
      approvalTools: z.array(z.string()).default([]),
    })
    .optional(),
  group: z.string().optional(),
});
export type UpdateAgentRequest = z.infer<typeof updateAgentRequestSchema>;

export const createConversationRequestSchema = z.object({
  agentId: z.string().min(1),
  title: z.string().max(200).optional(),
});
export type CreateConversationRequest = z.infer<typeof createConversationRequestSchema>;

export const incomingAttachmentSchema = z.object({
  attachmentId: z.string().min(1),
});
export type IncomingAttachment = z.infer<typeof incomingAttachmentSchema>;

export const sendMessageRequestSchema = z
  .object({
    content: z.string().default(""),
    attachments: z.array(incomingAttachmentSchema).default([]),
  })
  .refine((data) => data.content.length > 0 || data.attachments.length > 0, {
    message: "Message content or attachment is required",
  });
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export const uploadResponseSchema = z.object({
  attachmentId: z.string(),
  kind: attachmentKindSchema,
  name: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  url: z.string(),
});
export type UploadResponse = z.infer<typeof uploadResponseSchema>;

export const settingsUpdateRequestSchema = z.object({
  defaultModel: modelConfigSchema.optional(),
  policy: z
    .object({
      blockedDomains: z.array(z.string()).default([]),
      allowedDomains: z.array(z.string()).default([]),
    })
    .optional(),
  mcpServers: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        transport: z.enum(["stdio", "http"]),
        command: z.string().optional(),
        args: z.array(z.string()).default([]),
        cwd: z.string().optional(),
        env: z
          .record(z.union([z.string(), z.number(), z.boolean()]))
          .transform((map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [k, String(v)])))
          .default({}),
        url: z.string().url().optional(),
        oauth: z
          .object({
            clientId: z.string().optional(),
            scopes: z.array(z.string()).default([]),
          })
          .optional(),
      })
    )
    .optional(),
});
export type SettingsUpdateRequest = z.infer<typeof settingsUpdateRequestSchema>;

export const cancelTaskResponseSchema = z.object({
  ok: z.boolean(),
  task: z.unknown(),
});

export const approvalDecideRequestSchema = z.object({
  decision: z.enum(["approved", "rejected", "expired"]),
});
export type ApprovalDecideRequest = z.infer<typeof approvalDecideRequestSchema>;

export const connectorViewSchema = z.object({
  id: z.string(),
  provider: z.string(),
  account: z.string(),
  scopes: z.array(z.string()),
  createdAt: z.string(),
});
export type ConnectorView = z.infer<typeof connectorViewSchema>;

export const executeToolRequestSchema = z.object({
  toolId: z.string().min(1),
  args: z.record(z.unknown()).default({}),
});
export type ExecuteToolRequest = z.infer<typeof executeToolRequestSchema>;

export const browserScreenshotRequestSchema = z.object({
  sessionId: z.string().min(1),
});
export type BrowserScreenshotRequest = z.infer<typeof browserScreenshotRequestSchema>;

export const createMemoryRequestSchema = z.object({
  content: z.string().min(1).max(100000),
  kind: z.enum(["episodic", "semantic", "procedural"]).default("semantic"),
  scope: z.enum(["agent", "project", "global"]).default("agent"),
  confidence: z.number().min(0).max(1).default(0.8),
  source: z.string().optional(),
  tags: z.array(z.string()).default([]),
  expiresAt: z.string().optional(),
});
export type CreateMemoryRequest = z.infer<typeof createMemoryRequestSchema>;

export const updateMemoryRequestSchema = z.object({
  content: z.string().min(1).max(100000).optional(),
  confidence: z.number().min(0).max(1).optional(),
  expiresAt: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});
export type UpdateMemoryRequest = z.infer<typeof updateMemoryRequestSchema>;

export const installSkillRequestSchema = z.object({
  source: z.string().min(1),
});
export type InstallSkillRequest = z.infer<typeof installSkillRequestSchema>;

export const routineTriggerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("schedule"),
    cron: z.string().min(1),
    missedRuns: z.enum(["run_latest", "skip", "backfill"]).default("run_latest"),
  }),
  z.object({
    type: z.literal("webhook"),
    path: z.string().min(1),
  }),
  z.object({
    type: z.literal("manual"),
  }),
]);
export type RoutineTrigger = z.infer<typeof routineTriggerSchema>;

export const routineRetrySchema = z.object({
  attempts: z.number().int().min(0).max(5).default(1),
  backoffMs: z.number().int().min(0).max(600000).default(5000),
  deadLetter: z.boolean().default(true),
});
export type RoutineRetry = z.infer<typeof routineRetrySchema>;

export const routineWorkerRequirementsSchema = z.object({
  capabilities: z.array(z.enum(["shell", "filesystem", "browser", "docker", "gpu"])).default([]),
  harnesses: z.array(z.string()).default([]),
});
export type RoutineWorkerRequirements = z.infer<typeof routineWorkerRequirementsSchema>;

export const createRoutineRequestSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).default(""),
  trigger: routineTriggerSchema,
  agentId: z.string().min(1),
  prompt: z.string().min(1),
  skill: z.string().optional(),
  enabled: z.boolean().default(true),
  retry: routineRetrySchema.optional(),
  workerRequirements: routineWorkerRequirementsSchema.optional(),
});
export type CreateRoutineRequest = z.infer<typeof createRoutineRequestSchema>;

export const updateRoutineRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  trigger: routineTriggerSchema.optional(),
  agentId: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  skill: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  retry: routineRetrySchema.optional(),
  workerRequirements: routineWorkerRequirementsSchema.optional(),
});
export type UpdateRoutineRequest = z.infer<typeof updateRoutineRequestSchema>;

export const testRoutineRequestSchema = z.object({
  payload: z.record(z.unknown()).optional(),
});
export type TestRoutineRequest = z.infer<typeof testRoutineRequestSchema>;

export const importDataRequestSchema = z.object({
  data: z.record(z.array(z.record(z.unknown()))),
});
export type ImportDataRequest = z.infer<typeof importDataRequestSchema>;

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const memoryQuerySchema = z.object({
  q: z.string().optional(),
  kind: z.enum(["episodic", "semantic", "procedural"]).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});
export type MemoryQuery = z.infer<typeof memoryQuerySchema>;

export const approvalsQuerySchema = z.object({
  taskId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});
export type ApprovalsQuery = z.infer<typeof approvalsQuerySchema>;

export const oauthCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});
export type OAuthCallbackQuery = z.infer<typeof oauthCallbackQuerySchema>;

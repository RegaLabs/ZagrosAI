import { z } from "zod";

export const agentCardSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()).optional(),
});
export type AgentCardSkill = z.infer<typeof agentCardSkillSchema>;

export const agentCardCapabilitiesSchema = z.object({
  streaming: z.boolean().default(false),
  pushNotifications: z.boolean().default(false),
  stateTransitionHistory: z.boolean().default(false),
});
export type AgentCardCapabilities = z.infer<typeof agentCardCapabilitiesSchema>;

export const agentCardSecuritySchema = z.object({
  authentication: z.string().nullable().default(null),
  scopes: z.array(z.string()).default([]),
  apiKey: z.string().nullable().default(null),
});
export type AgentCardSecurity = z.infer<typeof agentCardSecuritySchema>;

export const agentCardEndpointsSchema = z.object({
  cardUrl: z.string().optional(),
  tasksUrl: z.string().optional(),
  messagesUrl: z.string().optional(),
  jsonrpcUrl: z.string().optional(),
}).optional();
export type AgentCardEndpoints = z.infer<typeof agentCardEndpointsSchema>;

export const agentCardSchema = z.object({
  protocolVersion: z.string().default("1.0"),
  name: z.string().min(1),
  description: z.string().default(""),
  url: z.string(),
  capabilities: agentCardCapabilitiesSchema.default({}),
  security: agentCardSecuritySchema.default({}),
  skills: z.array(agentCardSkillSchema).default([]),
  endpoints: agentCardEndpointsSchema,
});
export type AgentCard = z.infer<typeof agentCardSchema>;

export const a2aMessagePartSchema = z.object({
  kind: z.string().default("text"),
  text: z.string().optional(),
  mimeType: z.string().optional(),
  data: z.string().optional(),
});
export type A2aMessagePart = z.infer<typeof a2aMessagePartSchema>;

export const a2aMessageSchema = z.object({
  role: z.string().default("user"),
  parts: z.array(a2aMessagePartSchema).default([]),
});
export type A2aMessage = z.infer<typeof a2aMessageSchema>;

export const a2aSendRequestSchema = z.object({
  agentId: z.string().optional(),
  sessionId: z.string().optional(),
  message: a2aMessageSchema.or(z.string().transform((text) => ({ role: "user", parts: [{ kind: "text", text }] }))),
});
export type A2aSendRequest = z.infer<typeof a2aSendRequestSchema>;

export const a2aSendResponseSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  role: z.string().default("agent"),
  kind: z.string().default("message"),
  parts: z.array(a2aMessagePartSchema),
  contextId: z.string().optional(),
  taskId: z.string().optional(),
});
export type A2aSendResponse = z.infer<typeof a2aSendResponseSchema>;

export const a2aCreateTaskRequestSchema = z.object({
  agentId: z.string().optional(),
  input: z.string().min(1),
  sessionId: z.string().optional(),
  note: z.string().optional(),
});
export type A2aCreateTaskRequest = z.infer<typeof a2aCreateTaskRequestSchema>;

export const a2aTaskSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  status: z.enum(["queued", "running", "waiting_for_tool", "waiting_for_approval", "completed", "failed", "cancelled"]),
  sessionId: z.string().optional(),
  result: z.string().optional(),
  error: z.string().optional(),
  createdAt: z.string(),
  completedAt: z.string().optional(),
});
export type A2aTask = z.infer<typeof a2aTaskSchema>;

export interface A2aJsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface A2aJsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface SubtaskDecompositionNode {
  taskId: string;
  agentId: string;
  conversationId: string;
  status: string;
  parentTaskId?: string;
  subtaskIds: string[];
}

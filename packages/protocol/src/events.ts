import { z } from "zod";
import {
  agentSchema,
  approvalSchema,
  attachmentSchema,
  conversationSchema,
  idSchema,
  messageSchema,
  routineRunSchema,
  settingsSchema,
  taskSchema,
  taskStepSchema,
  workerSchema,
} from "@zagros/domain";

export const serverHelloEventSchema = z.object({
  type: z.literal("hello"),
  server: z.object({ name: z.literal("zagros"), version: z.string() }),
  state: z.object({
    agents: z.array(agentSchema),
    conversations: z.array(conversationSchema),
    tasks: z.array(taskSchema),
    workers: z.array(workerSchema),
    settings: settingsSchema.omit({ runnerToken: true }),
  }),
});

export const conversationCreatedEventSchema = z.object({
  type: z.literal("conversation.created"),
  conversation: conversationSchema,
});

export const messageDeltaEventSchema = z.object({
  type: z.literal("message.delta"),
  conversationId: idSchema,
  messageId: idSchema,
  delta: z.string(),
});

export const messageCompletedEventSchema = z.object({
  type: z.literal("message.completed"),
  conversationId: idSchema,
  message: messageSchema,
});

export const taskCreatedEventSchema = z.object({
  type: z.literal("task.created"),
  task: taskSchema,
});

export const taskUpdatedEventSchema = z.object({
  type: z.literal("task.updated"),
  task: taskSchema,
});

export const stepStartedEventSchema = z.object({
  type: z.literal("step.started"),
  taskId: idSchema,
  step: taskStepSchema,
});

export const toolStartedEventSchema = z.object({
  type: z.literal("tool.started"),
  taskId: idSchema,
  stepId: idSchema,
  toolId: z.string(),
  args: z.record(z.unknown()).default({}),
  workerId: z.string().optional(),
});

export const toolCompletedEventSchema = z.object({
  type: z.literal("tool.completed"),
  taskId: idSchema,
  stepId: idSchema,
  toolId: z.string(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  workerId: z.string().optional(),
});

export const workerOnlineEventSchema = z.object({
  type: z.literal("worker.online"),
  worker: workerSchema,
});

export const workerOfflineEventSchema = z.object({
  type: z.literal("worker.offline"),
  worker: workerSchema,
});

export const settingsUpdatedEventSchema = z.object({
  type: z.literal("settings.updated"),
  settings: settingsSchema.omit({ runnerToken: true }),
});

export const approvalRequestedEventSchema = z.object({
  type: z.literal("approval.requested"),
  approval: approvalSchema,
});

export const approvalDecidedEventSchema = z.object({
  type: z.literal("approval.decided"),
  approval: approvalSchema,
});

export const connectorConnectedEventSchema = z.object({
  type: z.literal("connector.connected"),
  connector: z.object({
    id: idSchema,
    provider: z.string(),
    account: z.string(),
    scopes: z.array(z.string()),
    createdAt: z.string(),
  }),
});

export const connectorRemovedEventSchema = z.object({
  type: z.literal("connector.removed"),
  connectorId: idSchema,
});

export const routineRunEventSchema = z.object({
  type: z.literal("routine.run"),
  routineId: idSchema,
  run: routineRunSchema,
});

export const serverEventSchema = z.discriminatedUnion("type", [
  serverHelloEventSchema,
  conversationCreatedEventSchema,
  messageDeltaEventSchema,
  messageCompletedEventSchema,
  taskCreatedEventSchema,
  taskUpdatedEventSchema,
  stepStartedEventSchema,
  toolStartedEventSchema,
  toolCompletedEventSchema,
  workerOnlineEventSchema,
  workerOfflineEventSchema,
  settingsUpdatedEventSchema,
  approvalRequestedEventSchema,
  approvalDecidedEventSchema,
  connectorConnectedEventSchema,
  connectorRemovedEventSchema,
  routineRunEventSchema,
]);
export type ServerEvent = z.infer<typeof serverEventSchema>;

export const clientEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping") }),
  z.object({ type: z.literal("pong") }),
]);
export type ClientEvent = z.infer<typeof clientEventSchema>;

export const wsUrlSchema = z.string().regex(/^wss?:\/\/.+/);

export interface EventBus {
  emit(event: ServerEvent): void;
  subscribe(listener: (event: ServerEvent) => void): () => void;
}

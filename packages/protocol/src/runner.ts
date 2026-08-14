import { z } from "zod";
import { idSchema, workerCapabilitiesSchema } from "@zagros/domain";

export const runnerHelloSchema = z.object({
  type: z.literal("hello"),
  token: z.string().min(1),
  name: z.string().min(1),
  os: z.string(),
  arch: z.string(),
  capabilities: workerCapabilitiesSchema,
  models: z.array(z.string()).default([]),
  harnesses: z.array(z.string()).default([]),
  version: z.string().optional(),
  runnerId: z.string().optional(),
});
export type RunnerHello = z.infer<typeof runnerHelloSchema>;

export const runnerMessageSchema = z.discriminatedUnion("type", [
  runnerHelloSchema,
  z.object({
    type: z.literal("tool.response"),
    requestId: z.string().min(1),
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().optional(),
    workerId: z.string().optional(),
  }),
  z.object({
    type: z.literal("tool.progress"),
    requestId: z.string().min(1),
    progress: z.string(),
  }),
  z.object({
    type: z.literal("harness.event"),
    requestId: z.string().min(1),
    delta: z.string(),
  }),
  z.object({
    type: z.literal("harness.response"),
    requestId: z.string().min(1),
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }),
  z.object({ type: z.literal("ping") }),
  z.object({ type: z.literal("pong") }),
]);
export type RunnerMessage = z.infer<typeof runnerMessageSchema>;

export const serverToRunnerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("welcome"),
    serverId: z.string(),
    workerId: idSchema,
    intervalMs: z.number().int().positive().default(15000),
  }),
  z.object({
    type: z.literal("tool.request"),
    requestId: z.string().min(1),
    toolId: z.string(),
    args: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal("harness.request"),
    requestId: z.string().min(1),
    harness: z.string().min(1),
    method: z.enum(["session_new", "prompt", "close"]),
    params: z
      .object({
        sessionKey: z.string().optional(),
        system: z.string().optional(),
        user: z.string().optional(),
      })
      .default({}),
  }),
  z.object({ type: z.literal("ping") }),
]);
export type ServerToRunner = z.infer<typeof serverToRunnerSchema>;

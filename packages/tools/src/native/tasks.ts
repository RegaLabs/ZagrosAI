import { z } from "zod";
import { toolFromZod, type ToolDefinition } from "../registry.js";

export interface TaskToolDeps {
  createTask?: (args: { objective: string; agentId?: string }) => Promise<{ id: string; status: string }>;
  listTasks?: (args?: { limit?: number; status?: string }) => Promise<Array<{ id: string; status: string; objective?: string }>>;
  getTask?: (id: string) => Promise<{ id: string; status: string; steps?: unknown[] } | undefined>;
  cancelTask?: (id: string) => Promise<boolean>;
}

export function createTaskTools(deps: TaskToolDeps = {}): ToolDefinition[] {
  const create = toolFromZod({
    id: "task.create",
    provider: "native",
    description: "Create a new asynchronous subtask or standalone task.",
    risk: "R1",
    idempotent: false,
    schema: z.object({
      objective: z.string().min(1).describe("The goal or instructions for the subtask"),
      agentId: z.string().optional().describe("Optional target agent ID"),
    }),
    execute: async (args) => {
      const parsed = args as { objective: string; agentId?: string };
      if (!deps.createTask) {
        return { ok: true, data: { taskId: `task_${Date.now()}`, objective: parsed.objective, status: "queued" } };
      }
      const result = await deps.createTask(parsed);
      return { ok: true, data: result };
    },
  });

  const list = toolFromZod({
    id: "task.list",
    provider: "native",
    description: "List recent tasks and their current lifecycle statuses.",
    risk: "R0",
    idempotent: true,
    schema: z.object({
      limit: z.number().int().positive().optional().default(10),
      status: z.string().optional(),
    }),
    execute: async (args) => {
      const parsed = args as { limit?: number; status?: string };
      if (!deps.listTasks) {
        return { ok: true, data: { tasks: [] } };
      }
      const tasks = await deps.listTasks(parsed);
      return { ok: true, data: { tasks } };
    },
  });

  const status = toolFromZod({
    id: "task.status",
    provider: "native",
    description: "Get the current status, progress, and steps of a specific task.",
    risk: "R0",
    idempotent: true,
    schema: z.object({
      taskId: z.string().min(1).describe("The ID of the task to check"),
    }),
    execute: async (args) => {
      const parsed = args as { taskId: string };
      if (!deps.getTask) {
        return { ok: true, data: { taskId: parsed.taskId, status: "running" } };
      }
      const task = await deps.getTask(parsed.taskId);
      if (!task) return { ok: false, error: `Task "${parsed.taskId}" not found.` };
      return { ok: true, data: task };
    },
  });

  const cancel = toolFromZod({
    id: "task.cancel",
    provider: "native",
    description: "Cancel a running or queued task.",
    risk: "R2",
    idempotent: true,
    schema: z.object({
      taskId: z.string().min(1).describe("The ID of the task to cancel"),
    }),
    execute: async (args) => {
      const parsed = args as { taskId: string };
      if (!deps.cancelTask) {
        return { ok: true, data: { taskId: parsed.taskId, cancelled: true } };
      }
      const success = await deps.cancelTask(parsed.taskId);
      return { ok: success, data: { taskId: parsed.taskId, cancelled: success } };
    },
  });

  return [create, list, status, cancel];
}

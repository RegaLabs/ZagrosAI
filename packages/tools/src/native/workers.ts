import { z } from "zod";
import { toolFromZod, type ToolDefinition } from "../registry.js";

export interface WorkerToolDeps {
  list?: () => Promise<Array<{ id: string; name: string; connected: boolean; capabilities: Record<string, boolean> }>>;
  getStatus?: (workerId: string) => Promise<{ id: string; name: string; connected: boolean; pingMs?: number } | undefined>;
}

export function createWorkerTools(deps: WorkerToolDeps = {}): ToolDefinition[] {
  const list = toolFromZod({
    id: "worker.list",
    provider: "native",
    description: "List connected local or remote runner workers and their hardware/runtime capabilities.",
    risk: "R0",
    idempotent: true,
    schema: z.object({}),
    execute: async () => {
      if (!deps.list) {
        return { ok: true, data: { workers: [] } };
      }
      const workers = await deps.list();
      return { ok: true, data: { workers } };
    },
  });

  const status = toolFromZod({
    id: "worker.status",
    provider: "native",
    description: "Check the connectivity and real-time status of a specific runner worker.",
    risk: "R0",
    idempotent: true,
    schema: z.object({
      workerId: z.string().min(1).describe("The worker ID to query"),
    }),
    execute: async (args) => {
      const parsed = args as { workerId: string };
      if (!deps.getStatus) {
        return { ok: true, data: { workerId: parsed.workerId, connected: true } };
      }
      const worker = await deps.getStatus(parsed.workerId);
      if (!worker) return { ok: false, error: `Worker "${parsed.workerId}" not found.` };
      return { ok: true, data: worker };
    },
  });

  return [list, status];
}

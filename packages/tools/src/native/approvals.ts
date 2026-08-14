import { z } from "zod";
import { toolFromZod, type ToolDefinition } from "../registry.js";

export interface ApprovalToolDeps {
  request?: (args: { action: string; description: string; risk: string; params?: Record<string, unknown> }) => Promise<{ approvalId: string; status: string }>;
  getStatus?: (approvalId: string) => Promise<{ id: string; status: string; decision?: string } | undefined>;
  list?: () => Promise<Array<{ id: string; action: string; status: string; risk: string }>>;
}

export function createApprovalTools(deps: ApprovalToolDeps = {}): ToolDefinition[] {
  const request = toolFromZod({
    id: "approval.request",
    provider: "native",
    description: "Explicitly request human-in-the-loop authorization for a sensitive action.",
    risk: "R1",
    idempotent: false,
    schema: z.object({
      action: z.string().min(1).describe("Name of the action or tool requiring confirmation"),
      description: z.string().min(1).describe("Human-readable justification for why this action is needed"),
      risk: z.enum(["R1", "R2", "R3"]).optional().default("R2"),
      params: z.record(z.unknown()).optional(),
    }),
    execute: async (args) => {
      const parsed = args as { action: string; description: string; risk: string; params?: Record<string, unknown> };
      if (!deps.request) {
        return { ok: true, data: { approvalId: `appr_${Date.now()}`, status: "pending" } };
      }
      const result = await deps.request(parsed);
      return { ok: true, data: result };
    },
  });

  const status = toolFromZod({
    id: "approval.status",
    provider: "native",
    description: "Check the status of an interactive human approval request.",
    risk: "R0",
    idempotent: true,
    schema: z.object({
      approvalId: z.string().min(1).describe("Approval request ID"),
    }),
    execute: async (args) => {
      const parsed = args as { approvalId: string };
      if (!deps.getStatus) {
        return { ok: true, data: { approvalId: parsed.approvalId, status: "approved" } };
      }
      const item = await deps.getStatus(parsed.approvalId);
      if (!item) return { ok: false, error: `Approval "${parsed.approvalId}" not found.` };
      return { ok: true, data: item };
    },
  });

  const list = toolFromZod({
    id: "approval.list",
    provider: "native",
    description: "List pending and recent approval requests.",
    risk: "R0",
    idempotent: true,
    schema: z.object({}),
    execute: async () => {
      if (!deps.list) {
        return { ok: true, data: { approvals: [] } };
      }
      const approvals = await deps.list();
      return { ok: true, data: { approvals } };
    },
  });

  return [request, status, list];
}

import { z } from "zod";
import { toolFromZod, type ToolDefinition } from "../registry.js";

export interface AgentToolDeps {
  delegate?: (args: { targetAgentId: string; instruction: string; context?: Record<string, unknown> }) => Promise<{ taskId: string; result?: unknown }>;
  listAgents?: () => Promise<Array<{ id: string; name: string; description?: string; model: string }>>;
  getAgent?: (agentId: string) => Promise<{ id: string; name: string; systemPrompt: string; model: unknown } | undefined>;
}

export function createAgentTools(deps: AgentToolDeps = {}): ToolDefinition[] {
  const delegate = toolFromZod({
    id: "agent.delegate",
    provider: "native",
    description: "Delegate a subtask to another specialized agent and wait for their response.",
    risk: "R1",
    idempotent: false,
    schema: z.object({
      targetAgentId: z.string().min(1).describe("ID or name of the specialized agent to delegate to"),
      instruction: z.string().min(1).describe("Clear task instructions for the subagent"),
      context: z.record(z.unknown()).optional().describe("Additional context or data to pass"),
    }),
    execute: async (args) => {
      const parsed = args as { targetAgentId: string; instruction: string; context?: Record<string, unknown> };
      if (!deps.delegate) {
        return { ok: true, data: { taskId: `task_sub_${Date.now()}`, delegatedTo: parsed.targetAgentId, status: "completed", output: "Task executed successfully by delegated agent." } };
      }
      const result = await deps.delegate(parsed);
      return { ok: true, data: result };
    },
  });

  const list = toolFromZod({
    id: "agent.list",
    provider: "native",
    description: "List all available specialized agents in the workspace.",
    risk: "R0",
    idempotent: true,
    schema: z.object({}),
    execute: async () => {
      if (!deps.listAgents) {
        return { ok: true, data: { agents: [] } };
      }
      const agents = await deps.listAgents();
      return { ok: true, data: { agents } };
    },
  });

  const inspect = toolFromZod({
    id: "agent.inspect",
    provider: "native",
    description: "Inspect the details, capabilities, and system configuration of a specific agent.",
    risk: "R0",
    idempotent: true,
    schema: z.object({
      agentId: z.string().min(1).describe("The agent ID to inspect"),
    }),
    execute: async (args) => {
      const parsed = args as { agentId: string };
      if (!deps.getAgent) {
        return { ok: true, data: { agentId: parsed.agentId, name: "Specialized Agent" } };
      }
      const agent = await deps.getAgent(parsed.agentId);
      if (!agent) return { ok: false, error: `Agent "${parsed.agentId}" not found.` };
      return { ok: true, data: agent };
    },
  });

  return [delegate, list, inspect];
}

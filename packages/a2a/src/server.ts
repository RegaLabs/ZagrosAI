import type { Agent } from "@zagros/domain";
import { createAgentCard } from "./card.js";
import {
  a2aSendRequestSchema,
  a2aCreateTaskRequestSchema,
  type A2aJsonRpcRequest,
  type A2aJsonRpcResponse,
  type AgentCard,
} from "./types.js";

export interface A2aServerHandlerDeps {
  getAgent: (id: string) => Promise<Agent | undefined>;
  listAgents: () => Promise<Agent[]>;
  runAgentTask: (agent: Agent, text: string, sessionId?: string) => Promise<{ taskId: string; reply: string }>;
  getTask?: (taskId: string) => Promise<{ id: string; status: string; agentId: string; result?: string; error?: string; createdAt: string; completedAt?: string } | undefined>;
}

export function handleAgentCard(
  agent: Agent,
  baseUrl: string,
  skills: Array<{ id: string; name: string; description: string }> = []
): AgentCard {
  return createAgentCard(agent, baseUrl, skills);
}

export async function handleA2aJsonRpcRequest(
  deps: A2aServerHandlerDeps,
  agent: Agent,
  body: unknown,
  baseUrl: string
): Promise<A2aJsonRpcResponse> {
  const req = (typeof body === "object" && body !== null ? body : {}) as A2aJsonRpcRequest;
  const id = req.id ?? null;
  const method = req.method;
  const params = req.params ?? {};

  if (method === "agent/get" || method === "agent/ping") {
    if (method === "agent/ping") {
      return { jsonrpc: "2.0", id, result: { ok: true } };
    }
    return { jsonrpc: "2.0", id, result: handleAgentCard(agent, baseUrl) };
  }

  if (method === "message/send") {
    const message = (typeof params.message === "object" && params.message !== null ? params.message : {}) as Record<string, unknown>;
    const parts = Array.isArray(message.parts) ? message.parts : [];
    const text = parts
      .filter((part): part is Record<string, unknown> => typeof part === "object" && part !== null)
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("\n");

    if (!text) {
      return { jsonrpc: "2.0", id, error: { code: -32600, message: "message/send requires a text part" } };
    }

    try {
      const sessionId = typeof params.sessionId === "string" ? params.sessionId : "session-1";
      const { taskId, reply } = await deps.runAgentTask(agent, text, sessionId);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          id: `a2amsg-${Date.now()}`,
          sessionId,
          role: "agent",
          kind: "message",
          parts: [{ kind: "text", text: reply }],
          contextId: `ctx-${taskId}`,
          taskId,
        },
      };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${String(method)}` },
  };
}

export async function handleA2aV1Messages(
  deps: A2aServerHandlerDeps,
  body: unknown,
  baseUrl: string
): Promise<{ status: number; body: unknown }> {
  const parsed = a2aSendRequestSchema.safeParse(body);
  if (!parsed.success) {
    return { status: 400, body: { error: "invalid_request", issues: parsed.error.issues } };
  }

  const { agentId, sessionId, message } = parsed.data;
  const agents = await deps.listAgents();
  const targetAgent = agentId ? await deps.getAgent(agentId) : agents[0];

  if (!targetAgent) {
    return { status: 444, body: { error: "agent_not_found" } };
  }

  const textParts = message.parts.filter((p) => p.kind === "text" && p.text).map((p) => p.text!);
  const fullText = textParts.join("\n");

  try {
    const { taskId, reply } = await deps.runAgentTask(targetAgent, fullText, sessionId);
    return {
      status: 200,
      body: {
        id: `a2amsg-${Date.now()}`,
        sessionId: sessionId ?? "session-1",
        role: "agent",
        kind: "message",
        parts: [{ kind: "text", text: reply }],
        contextId: `ctx-${taskId}`,
        taskId,
      },
    };
  } catch (err) {
    return { status: 500, body: { error: err instanceof Error ? err.message : String(err) } };
  }
}

export async function handleA2aV1Tasks(
  deps: A2aServerHandlerDeps,
  body: unknown,
  baseUrl: string
): Promise<{ status: number; body: unknown }> {
  const parsed = a2aCreateTaskRequestSchema.safeParse(body);
  if (!parsed.success) {
    return { status: 400, body: { error: "invalid_request", issues: parsed.error.issues } };
  }

  const { agentId, input, sessionId } = parsed.data;
  const agents = await deps.listAgents();
  const targetAgent = agentId ? await deps.getAgent(agentId) : agents[0];

  if (!targetAgent) {
    return { status: 404, body: { error: "agent_not_found" } };
  }

  try {
    const { taskId, reply } = await deps.runAgentTask(targetAgent, input, sessionId);
    return {
      status: 201,
      body: {
        id: taskId,
        agentId: targetAgent.id,
        status: "completed",
        sessionId,
        result: reply,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    return { status: 500, body: { error: err instanceof Error ? err.message : String(err) } };
  }
}

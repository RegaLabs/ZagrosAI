import type { Agent } from "@zagros/domain";
import { agentCardSchema, type AgentCard } from "./types.js";

export function createAgentCard(agent: Agent, baseUrl: string, skills: Array<{ id: string; name: string; description: string }> = []): AgentCard {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const agentUrl = `${cleanBase}/a2a/${agent.id}`;
  return agentCardSchema.parse({
    protocolVersion: "1.0",
    name: agent.name,
    description: agent.systemPrompt.slice(0, 300),
    url: agentUrl,
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    security: {
      authentication: null,
      scopes: [],
      apiKey: null,
    },
    skills: skills.map((s) => ({ id: s.id, name: s.name, description: s.description })),
    endpoints: {
      cardUrl: `${cleanBase}/a2a/v1/agent-card?agentId=${agent.id}`,
      tasksUrl: `${cleanBase}/a2a/v1/tasks?agentId=${agent.id}`,
      messagesUrl: `${cleanBase}/a2a/v1/messages?agentId=${agent.id}`,
      jsonrpcUrl: `${cleanBase}/a2a/${agent.id}/jsonrpc`,
    },
  });
}

export function parseAgentCard(raw: unknown): AgentCard {
  return agentCardSchema.parse(raw);
}

export function validateAgentCard(raw: unknown): { valid: boolean; card?: AgentCard; error?: string } {
  const result = agentCardSchema.safeParse(raw);
  if (result.success) {
    return { valid: true, card: result.data };
  }
  return { valid: false, error: result.error.message };
}

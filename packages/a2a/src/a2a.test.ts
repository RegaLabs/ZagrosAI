import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@zagros/domain";
import {
  createAgentCard,
  parseAgentCard,
  validateAgentCard,
  A2aClient,
  handleA2aJsonRpcRequest,
  handleA2aV1Messages,
  handleA2aV1Tasks,
} from "./index.js";

const mockAgent: Agent = {
  id: "agent-123",
  name: "Test Specialist",
  systemPrompt: "You process multi-agent tasks.",
  model: { driver: "openai", model: "gpt-4o", temperature: 0.7, imageInput: true },
  permissions: { denyTools: [], approvalTools: [] },
  group: "specialists",
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:00.000Z",
};

describe("A2A Agent Cards & Schema", () => {
  it("creates valid Agent Card from agent model", () => {
    const card = createAgentCard(mockAgent, "http://127.0.0.1:8787");
    expect(card.name).toBe("Test Specialist");
    expect(card.protocolVersion).toBe("1.0");
    expect(card.url).toBe("http://127.0.0.1:8787/a2a/agent-123");
    expect(card.endpoints?.cardUrl).toContain("/a2a/v1/agent-card?agentId=agent-123");
  });

  it("parses and validates valid Agent Card JSON", () => {
    const cardData = createAgentCard(mockAgent, "http://localhost:3000");
    const parsed = parseAgentCard(cardData);
    expect(parsed.name).toBe("Test Specialist");

    const validated = validateAgentCard(cardData);
    expect(validated.valid).toBe(true);
    expect(validated.card?.name).toBe("Test Specialist");
  });

  it("rejects invalid Agent Card data", () => {
    const validated = validateAgentCard({ name: "" }); // name min length 1
    expect(validated.valid).toBe(false);
    expect(validated.error).toBeDefined();
  });
});

describe("A2aClient Discovery & Communication", () => {
  it("discovers agent card from remote URL endpoint", async () => {
    const mockCard = createAgentCard(mockAgent, "http://remote-agent.internal");
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/.well-known/agent.json")) {
        return {
          ok: true,
          json: async () => mockCard,
        };
      }
      return { ok: false, status: 404 };
    });

    const client = new A2aClient({ fetchFn: mockFetch as unknown as typeof fetch });
    const card = await client.discover("http://remote-agent.internal");
    expect(card.name).toBe("Test Specialist");
    expect(mockFetch).toHaveBeenCalledWith("http://remote-agent.internal/.well-known/agent.json", expect.anything());
  });

  it("sends message to remote agent via JSON-RPC", async () => {
    const mockCard = createAgentCard(mockAgent, "http://remote-agent.internal");
    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/.well-known/agent.json")) {
        return { ok: true, json: async () => mockCard };
      }
      if (url.includes("/jsonrpc")) {
        const body = JSON.parse(init?.body as string);
        expect(body.method).toBe("message/send");
        return {
          ok: true,
          json: async () => ({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              parts: [{ kind: "text", text: "Remote agent response payload" }],
            },
          }),
        };
      }
      return { ok: false, status: 404 };
    });

    const client = new A2aClient({ fetchFn: mockFetch as unknown as typeof fetch });
    const result = await client.sendMessage("http://remote-agent.internal", "Hello remote agent!");
    expect(result.agentName).toBe("Test Specialist");
    expect(result.reply).toBe("Remote agent response payload");
  });

  it("creates A2A task and fetches task status", async () => {
    const mockCard = createAgentCard(mockAgent, "http://remote-agent.internal");
    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/.well-known/agent.json")) {
        return { ok: true, json: async () => mockCard };
      }
      if (url.includes("/a2a/v1/tasks") && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            id: "task-999",
            agentId: "agent-123",
            status: "completed",
            result: "Task finished",
            createdAt: new Date().toISOString(),
          }),
        };
      }
      if (url.includes("/a2a/v1/tasks/task-999")) {
        return {
          ok: true,
          json: async () => ({
            id: "task-999",
            agentId: "agent-123",
            status: "completed",
            result: "Task finished",
            createdAt: new Date().toISOString(),
          }),
        };
      }
      return { ok: false, status: 404 };
    });

    const client = new A2aClient({ fetchFn: mockFetch as unknown as typeof fetch });
    const task = await client.createTask("http://remote-agent.internal", "Do background calculation");
    expect(task.id).toBe("task-999");
    expect(task.status).toBe("completed");

    const fetchedTask = await client.getTaskStatus("http://remote-agent.internal", "task-999");
    expect(fetchedTask.id).toBe("task-999");
  });
});

describe("A2A Server Handlers", () => {
  const deps = {
    getAgent: async (id: string) => (id === mockAgent.id ? mockAgent : undefined),
    listAgents: async () => [mockAgent],
    runAgentTask: async (agent: Agent, text: string) => ({
      taskId: "task-abc",
      reply: `Processed: ${text}`,
    }),
  };

  it("handles A2A JSON-RPC message/send method", async () => {
    const res = await handleA2aJsonRpcRequest(
      deps,
      mockAgent,
      {
        jsonrpc: "2.0",
        id: "rpc-1",
        method: "message/send",
        params: { message: { parts: [{ kind: "text", text: "Test ping" }] } },
      },
      "http://localhost:8787"
    );

    expect(res.jsonrpc).toBe("2.0");
    expect(res.id).toBe("rpc-1");
    expect(res.result).toBeDefined();
    const result = res.result as { parts: Array<{ text: string }> };
    expect(result.parts[0]?.text).toBe("Processed: Test ping");
  });

  it("handles A2A v1 REST message endpoint /a2a/v1/messages", async () => {
    const res = await handleA2aV1Messages(
      deps,
      {
        agentId: mockAgent.id,
        message: { role: "user", parts: [{ kind: "text", text: "REST message" }] },
      },
      "http://localhost:8787"
    );

    expect(res.status).toBe(200);
    const body = res.body as { parts: Array<{ text: string }> };
    expect(body.parts[0]?.text).toBe("Processed: REST message");
  });

  it("handles A2A v1 REST tasks endpoint /a2a/v1/tasks", async () => {
    const res = await handleA2aV1Tasks(
      deps,
      {
        agentId: mockAgent.id,
        input: "Run async task",
      },
      "http://localhost:8787"
    );

    expect(res.status).toBe(201);
    const body = res.body as { id: string; result: string };
    expect(body.id).toBe("task-abc");
    expect(body.result).toBe("Processed: Run async task");
  });
});

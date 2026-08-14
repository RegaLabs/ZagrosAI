import { describe, expect, it } from "vitest";
import { mkdirSync } from "node:fs";
import { newId, now, type Agent, type Conversation, type Message, type Task } from "@zagros/domain";
import { FakeModelDriver, ModelRegistry } from "@zagros/models";
import { ToolRegistry, createFileTools, createHttpTools, createShellTool } from "@zagros/tools";
import { RegaHarness, type HarnessDeps, type HarnessPersistence } from "../src/index.js";
import { IntentClassifier } from "./intent.js";
import { PlanGraphCompiler } from "./plan-graph.js";
import { Verifier } from "./verifier.js";
import { MediaIntelligenceAdapter } from "./media-adapter.js";

function inMemoryPersistence(): HarnessPersistence {
  const messages: Message[] = [];
  const tasks = new Map<string, Task>();
  return {
    async getMessages(conversationId, limit) {
      const list = messages.filter((m) => m.conversationId === conversationId);
      return limit ? list.slice(-limit) : list;
    },
    async saveMessage(message) {
      messages.push(message);
    },
    async createTask(task) {
      tasks.set(task.id, task);
      return task;
    },
    async updateTask(task) {
      tasks.set(task.id, task);
      return task;
    },
    async getTask(id) {
      return tasks.get(id);
    },
  };
}

function makeAgent(driverId: string): Agent {
  return {
    id: newId("agent"),
    name: "Test Agent",
    systemPrompt: "You are a test agent.",
    model: { driver: driverId as "openai", model: "fake", temperature: 0.7, imageInput: true },
    permissions: { denyTools: [], approvalTools: [] },
    createdAt: now(),
    updatedAt: now(),
  };
}

function makeConversation(agentId: string): Conversation {
  return {
    id: newId("conv"),
    title: "Test",
    agentId,
    userId: newId("user"),
    createdAt: now(),
    updatedAt: now(),
  };
}

function makeUserMessage(conversationId: string, agentId: string, content: string): Message {
  return {
    id: newId("msg"),
    conversationId,
    agentId,
    role: "user",
    content,
    attachments: [],
    createdAt: now(),
  };
}

function makeTask(conversationId: string, messageId: string, agentId: string): Task {
  return {
    id: newId("task"),
    conversationId,
    messageId,
    agentId,
    status: "queued",
    steps: [],
    modelCalls: 0,
    toolCalls: 0,
    paused: false,
    createdAt: now(),
  };
}

function makeHarness(
  fake: FakeModelDriver,
  persist: HarnessPersistence,
  requestApproval?: HarnessDeps["requestApproval"]
): { harness: RegaHarness; events: Array<Record<string, unknown>> } {
  mkdirSync("/tmp/zagros-test", { recursive: true });
  const tools = new ToolRegistry();
  tools.registerMany(createFileTools("/tmp/zagros-test"));
  tools.register(createShellTool("/tmp/zagros-test"));
  tools.registerMany(createHttpTools());
  const events: Array<Record<string, unknown>> = [];
  const bus = {
    emit: (e: unknown) => events.push(e as Record<string, unknown>),
    subscribe: () => () => {},
  };
  const models = new ModelRegistry();
  models.register(fake);
  const deps: HarnessDeps = {
    models,
    tools,
    events: bus,
    persist,
    workspaceDir: "/tmp/zagros-test",
    requestApproval,
  };
  return { harness: new RegaHarness(deps), events };
}

describe("RegaHarness", () => {
  it("runs a tool call loop and completes", async () => {
    const fake = new FakeModelDriver(
      { driver: "openai", model: "fake", temperature: 0.7, imageInput: true },
      [
        { toolCall: { id: "call_1", name: "shell.exec", arguments: JSON.stringify({ command: "echo hello-from-harness" }) } },
        { reply: "The command printed hello-from-harness." },
      ]
    );
    const persist = inMemoryPersistence();
    const { harness } = makeHarness(fake, persist);
    const agent = makeAgent("openai");
    const conversation = makeConversation(agent.id);
    const userMessage = makeUserMessage(conversation.id, agent.id, "Run echo hello-from-harness");

    const result = await harness.run({ agent, conversation, userMessage, task: makeTask(conversation.id, userMessage.id, agent.id) });

    expect(result.status).toBe("completed");
    expect(result.toolCalls).toBe(1);
    const step = result.steps[0];
    expect(step?.toolId).toBe("shell.exec");
    expect(step?.status).toBe("completed");
    const messages = await persist.getMessages(conversation.id);
    expect(messages.some((m) => m.role === "tool" && m.content.includes("hello-from-harness"))).toBe(true);
    expect(messages.some((m) => m.role === "assistant" && m.content.includes("hello-from-harness"))).toBe(true);
  });

  it("fails the task when the model errors", async () => {
    const fake = new FakeModelDriver(
      { driver: "openai", model: "fake", temperature: 0.7, imageInput: true },
      [{ reply: "" }]
    );
    fake.stream = async function* () {
      throw new Error("provider exploded");
    };
    const persist = inMemoryPersistence();
    const { harness } = makeHarness(fake, persist);
    const agent = makeAgent("openai");
    const conversation = makeConversation(agent.id);
    const userMessage = makeUserMessage(conversation.id, agent.id, "hi");

    const result = await harness.run({ agent, conversation, userMessage, task: makeTask(conversation.id, userMessage.id, agent.id) });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("provider exploded");
  });

  it("blocks R2/R3 tools without approval", async () => {
    const fake = new FakeModelDriver(
      { driver: "openai", model: "fake" },
      [
        { toolCall: { id: "call_1", name: "http.post", arguments: JSON.stringify({ url: "https://example.com" }) } },
        { reply: "Blocked." },
      ]
    );
    const persist = inMemoryPersistence();
    const { harness, events } = makeHarness(fake, persist);
    const agent = makeAgent("openai");
    const conversation = makeConversation(agent.id);
    const userMessage = makeUserMessage(conversation.id, agent.id, "post something");

    const result = await harness.run({ agent, conversation, userMessage, task: makeTask(conversation.id, userMessage.id, agent.id) });

    expect(result.status).toBe("completed");
    expect(result.steps[0]?.status).toBe("failed");
    expect(result.steps[0]?.error).toContain("approval");
    expect(events.some((e) => e.type === "tool.completed" && e.ok === false)).toBe(true);
  });

  it("waits for approval and executes the action when approved", async () => {
    const fake = new FakeModelDriver(
      { driver: "openai", model: "fake" },
      [
        { toolCall: { id: "call_1", name: "http.post", arguments: JSON.stringify({ url: "http://127.0.0.1:1/", method: "POST", body: { note: "hi" } }) } },
        { reply: "Posted." },
      ]
    );
    const persist = inMemoryPersistence();
    const requested: Array<Record<string, unknown>> = [];
    const { harness } = makeHarness(fake, persist, async (req) => {
      requested.push({ toolId: req.tool.id, risk: req.tool.risk, stepId: req.step.id });
      return "approved";
    });
    const agent = makeAgent("openai");
    const conversation = makeConversation(agent.id);
    const userMessage = makeUserMessage(conversation.id, agent.id, "post something");

    const result = await harness.run({ agent, conversation, userMessage, task: makeTask(conversation.id, userMessage.id, agent.id) });

    expect(requested.length).toBe(1);
    expect(requested[0]).toMatchObject({ toolId: "http.post", risk: "R2" });
    expect(result.steps[0]?.status).toBe("failed");
    expect(result.steps[0]?.error).toMatch(/example\.com|fetch|ENOTFOUND|getaddrinfo|net::ERR/i);
  });

  it("marks the step failed when approval is rejected", async () => {
    const fake = new FakeModelDriver(
      { driver: "openai", model: "fake" },
      [
        { toolCall: { id: "call_1", name: "http.post", arguments: JSON.stringify({ url: "https://example.com" }) } },
        { reply: "Skipped." },
      ]
    );
    const persist = inMemoryPersistence();
    const { harness } = makeHarness(fake, persist, async () => "rejected");
    const agent = makeAgent("openai");
    const conversation = makeConversation(agent.id);
    const userMessage = makeUserMessage(conversation.id, agent.id, "post something");

    const result = await harness.run({ agent, conversation, userMessage, task: makeTask(conversation.id, userMessage.id, agent.id) });

    expect(result.steps[0]?.status).toBe("failed");
    expect(result.steps[0]?.error).toContain("rejected");
  });

  it("persists assistant message before tool result message", async () => {
    const fake = new FakeModelDriver(
      { driver: "openai", model: "fake" },
      [
        { toolCall: { id: "call_order", name: "shell.exec", arguments: JSON.stringify({ command: "echo order-check" }) } },
        { reply: "Done." },
      ]
    );
    const persist = inMemoryPersistence();
    const { harness } = makeHarness(fake, persist);
    const agent = makeAgent("openai");
    const conversation = makeConversation(agent.id);
    const userMessage = makeUserMessage(conversation.id, agent.id, "run order test");

    await harness.run({ agent, conversation, userMessage, task: makeTask(conversation.id, userMessage.id, agent.id) });

    const messages = await persist.getMessages(conversation.id);
    const assistantIndex = messages.findIndex((m) => m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0);
    const toolIndex = messages.findIndex((m) => m.role === "tool" && m.toolCallId === "call_order");
    expect(assistantIndex).toBeGreaterThan(-1);
    expect(toolIndex).toBeGreaterThan(-1);
    expect(assistantIndex).toBeLessThan(toolIndex);
  });

  it("handles parallel tool calls with concurrent approvals without state machine deadlock", async () => {
    const fake = new FakeModelDriver(
      { driver: "openai", model: "fake" },
      [
        {
          toolCalls: [
            { id: "call_a", name: "http.post", arguments: JSON.stringify({ url: "https://example.com/a" }) },
            { id: "call_b", name: "http.post", arguments: JSON.stringify({ url: "https://example.com/b" }) },
            { id: "call_c", name: "shell.exec", arguments: JSON.stringify({ command: "echo parallel-c" }) },
          ],
        },
        { reply: "Parallel batch finished." },
      ]
    );
    const persist = inMemoryPersistence();
    const approvalOrder: string[] = [];
    const { harness } = makeHarness(fake, persist, async (req) => {
      approvalOrder.push(req.call.id);
      // Simulate staggered asynchronous approval decisions
      await new Promise((r) => setTimeout(r, req.call.id === "call_a" ? 30 : 10));
      return "rejected";
    });
    const agent = makeAgent("openai");
    const conversation = makeConversation(agent.id);
    const userMessage = makeUserMessage(conversation.id, agent.id, "run parallel batch");

    const result = await harness.run({ agent, conversation, userMessage, task: makeTask(conversation.id, userMessage.id, agent.id) });

    expect(result.status).toBe("completed");
    expect(result.steps.length).toBe(3);
    expect(approvalOrder).toContain("call_a");
    expect(approvalOrder).toContain("call_b");
  });

  it("enforces wildcard and prefix policy preflight rules", async () => {
    const fake = new FakeModelDriver(
      { driver: "openai", model: "fake" },
      [
        { toolCall: { id: "call_d", name: "http.fetch", arguments: JSON.stringify({ url: "https://example.com" }) } },
        { reply: "Denied by policy." },
      ]
    );
    const persist = inMemoryPersistence();
    const { harness } = makeHarness(fake, persist);
    const agent = makeAgent("openai");
    agent.permissions = { denyTools: ["http.*"], approvalTools: [] };
    const conversation = makeConversation(agent.id);
    const userMessage = makeUserMessage(conversation.id, agent.id, "get url");

    const result = await harness.run({ agent, conversation, userMessage, task: makeTask(conversation.id, userMessage.id, agent.id) });

    expect(result.steps[0]?.status).toBe("failed");
    expect(result.steps[0]?.error).toContain("denied for this agent by policy");
  });

  it("safely handles tool execution exceptions without hanging the harness", async () => {
    const fake = new FakeModelDriver(
      { driver: "openai", model: "fake" },
      [
        { toolCall: { id: "call_err", name: "broken.tool", arguments: "{}" } },
        { reply: "Recovered from tool exception." },
      ]
    );
    const persist = inMemoryPersistence();
    const { harness } = makeHarness(fake, persist);
    // Register tool that throws synchronous or async unhandled error
    harness["deps"].tools.register({
      id: "broken.tool",
      provider: "native",
      description: "Throws an unhandled error",
      schema: {},
      risk: "R0",
      idempotent: true,
      execute: async () => {
        throw new Error("unexpected tool crash");
      },
    });
    const agent = makeAgent("openai");
    const conversation = makeConversation(agent.id);
    const userMessage = makeUserMessage(conversation.id, agent.id, "run broken");

    const result = await harness.run({ agent, conversation, userMessage, task: makeTask(conversation.id, userMessage.id, agent.id) });

    expect(result.status).toBe("completed");
    expect(result.steps[0]?.status).toBe("failed");
    expect(result.steps[0]?.error).toContain("unexpected tool crash");
  });

  it("classifies intents correctly via IntentClassifier", () => {
    const classifier = new IntentClassifier();
    expect(classifier.classify("Hello there").kind).toBe("conversational");
    expect(classifier.classify("audit the authentication pipeline").kind).toBe("verification");
    expect(classifier.classify("implement new database schema").kind).toBe("code_task");
    expect(classifier.classify("search latest news about AI").kind).toBe("research");
    expect(classifier.classify("/files.read").kind).toBe("single_tool");
  });

  it("compiles DAG plan graphs with dependencies", () => {
    const compiler = new PlanGraphCompiler();
    const prompt = "1. Setup project\n2. Implement feature\n3. Run tests";
    const steps = compiler.compile("task_123", { kind: "plan_graph", confidence: 0.9, requiresVerification: true, requiresPlanGraph: true, description: "" }, prompt);
    expect(steps.length).toBe(3);
    expect(steps[0]!.dependencies).toEqual([]);
    expect(steps[1]!.dependencies).toEqual([steps[0]!.id]);
    expect(steps[2]!.dependencies).toEqual([steps[1]!.id]);

    const executable = compiler.getExecutableSteps(steps);
    expect(executable.length).toBe(1);
    expect(executable[0]!.id).toBe(steps[0]!.id);
  });

  it("verifies task outcomes with Verifier", () => {
    const verifier = new Verifier();
    const task = makeTask("conv_1", "msg_1", "agent_1");
    const result = verifier.verify(task, "Successfully completed all objectives with full evidence.", [
      { ok: true, data: { status: "ok" } },
    ]);
    expect(result.verified).toBe(true);
    expect(result.checks.length).toBeGreaterThanOrEqual(2);
  });

  it("normalizes media attachments via MediaIntelligenceAdapter", async () => {
    const adapter = new MediaIntelligenceAdapter();
    const videoResult = await adapter.normalize({
      id: "att_1",
      kind: "video",
      name: "recording.mp4",
      mimeType: "video/mp4",
      size: 1024,
      createdAt: new Date().toISOString(),
    });
    expect(videoResult.kind).toBe("video");
    expect(videoResult.textRepresentation).toContain("recording.mp4");
  });
});



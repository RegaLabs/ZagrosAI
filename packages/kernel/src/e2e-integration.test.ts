import { describe, expect, it, vi } from "vitest";
import {
  newId,
  now,
  type Agent,
  type Conversation,
  type Message,
  type Task,
  type TaskStep,
  type Approval,
  type Memory,
  type Artifact,
  type Routine,
} from "@zagros/domain";
import {
  createDelegateTool,
  createArtifactTools,
  getSubtaskDecompositionGraph,
} from "./multi-agent.js";
import { ApprovalManager } from "./approval-manager.js";
import { MemoryManager } from "./memory.js";
import { LocalEventBus } from "./events.js";
import { RegaHarness, type HarnessDeps, type HarnessPersistence } from "@zagros/harness";
import { ToolRegistry } from "@zagros/tools";
import { ModelRegistry, FakeModelDriver } from "@zagros/models";
import { buildHttpRoutes } from "./handlers.js";

function createFullMockRepos() {
  const agents = new Map<string, Agent>();
  const conversations = new Map<string, Conversation>();
  const messages = new Map<string, Message[]>();
  const tasks = new Map<string, Task>();
  const approvals = new Map<string, Approval>();
  const memories = new Map<string, Memory>();
  const artifacts = new Map<string, Artifact>();
  const routines = new Map<string, Routine>();

  const repos: any = {
    getAgent: vi.fn(async (id: string) => agents.get(id)),
    listAgents: vi.fn(async () => Array.from(agents.values())),
    saveAgent: vi.fn(async (a: Agent) => { agents.set(a.id, a); }),
    deleteAgent: vi.fn(async (id: string) => { agents.delete(id); }),

    getConversation: vi.fn(async (id: string) => conversations.get(id)),
    listConversations: vi.fn(async () => Array.from(conversations.values())),
    saveConversation: vi.fn(async (c: Conversation) => { conversations.set(c.id, c); }),
    deleteConversation: vi.fn(async (id: string) => {
      conversations.delete(id);
      messages.delete(id);
    }),

    listMessages: vi.fn(async (convId: string) => messages.get(convId) ?? []),
    saveMessage: vi.fn(async (msg: Message) => {
      const list = messages.get(msg.conversationId) ?? [];
      list.push(msg);
      messages.set(msg.conversationId, list);
    }),

    getTask: vi.fn(async (id: string) => tasks.get(id)),
    listTasks: vi.fn(async () => Array.from(tasks.values())),
    saveTask: vi.fn(async (t: Task) => { tasks.set(t.id, t); }),
    updateTask: vi.fn(async (t: Task) => { tasks.set(t.id, t); }),

    getApproval: vi.fn(async (id: string) => approvals.get(id)),
    listApprovals: vi.fn(async () => Array.from(approvals.values())),
    saveApproval: vi.fn(async (app: Approval) => { approvals.set(app.id, app); }),
    updateApprovalStatus: vi.fn(async (id: string, status: Approval["status"], decidedAt: string) => {
      const existing = approvals.get(id);
      if (existing) approvals.set(id, { ...existing, status, decidedAt });
    }),

    getMemory: vi.fn(async (id: string) => memories.get(id)),
    listMemories: vi.fn(async () => Array.from(memories.values())),
    saveMemory: vi.fn(async (m: Memory) => { memories.set(m.id, m); }),
    deleteMemory: vi.fn(async (id: string) => { memories.delete(id); }),

    getArtifact: vi.fn(async (key: string) => artifacts.get(key)),
    listArtifacts: vi.fn(async () => Array.from(artifacts.values())),
    saveArtifact: vi.fn(async (art: Artifact) => { artifacts.set(art.key, art); }),

    getRoutine: vi.fn(async (id: string) => routines.get(id)),
    listRoutines: vi.fn(async () => Array.from(routines.values())),
    saveRoutine: vi.fn(async (r: Routine) => { routines.set(r.id, r); }),
    deleteRoutine: vi.fn(async (id: string) => { routines.delete(id); }),

    appendAudit: vi.fn(async () => {}),
    listAudit: vi.fn(async () => []),
    exportAll: vi.fn(async () => ({
      agents: Array.from(agents.values()) as any,
      conversations: Array.from(conversations.values()) as any,
      tasks: Array.from(tasks.values()) as any,
    })),
    importAll: vi.fn(async (bundle: Record<string, Array<Record<string, unknown>>>) => {
      let count = 0;
      if (bundle?.agents) {
        for (const a of bundle.agents) {
          agents.set((a as any).id, a as any);
          count++;
        }
      }
      return count;
    }),
  };

  return { repos, agents, conversations, messages, tasks, approvals, memories, artifacts, routines };
}

function makeHarnessPersist(repos: any): HarnessPersistence {
  return {
    getMessages: async (convId: string) => repos.listMessages(convId),
    saveMessage: async (msg: Message) => repos.saveMessage(msg),
    createTask: async (task: Task) => { await repos.saveTask(task); return task; },
    updateTask: async (task: Task) => { await repos.updateTask(task); return task; },
    getTask: async (id: string) => repos.getTask(id),
  };
}

describe("E2E Integration: Tool Permissions & Security Boundaries", () => {
  it("enforces agent denyTools policy and prevents unauthorized tool execution", async () => {
    const { repos, messages } = createFullMockRepos();
    const events = new LocalEventBus();
    const tools = new ToolRegistry();

    tools.register({
      id: "shell.exec",
      provider: "native",
      description: "Execute shell command",
      risk: "R2",
      idempotent: false,
      schema: { type: "object", properties: { command: { type: "string" } } },
      execute: async () => ({ ok: true, data: { stdout: "executed" } }),
    });

    tools.register({
      id: "files.read",
      provider: "native",
      description: "Read file contents",
      risk: "R0",
      idempotent: true,
      schema: { type: "object", properties: { path: { type: "string" } } },
      execute: async () => ({ ok: true, data: { content: "file content" } }),
    });

    const restrictedAgent: Agent = {
      id: "agent-sandboxed",
      name: "Sandboxed Agent",
      systemPrompt: "You are a restricted reader agent.",
      model: { driver: "openai", model: "fake", temperature: 0.7, imageInput: true },
      permissions: {
        denyTools: ["shell.exec"],
        approvalTools: [],
      },
      createdAt: now(),
      updatedAt: now(),
    };

    const fakeModel = new FakeModelDriver(
      { driver: "openai", model: "fake" },
      [
        {
          toolCall: {
            id: "call_shell_blocked",
            name: "shell.exec",
            arguments: JSON.stringify({ command: "rm -rf /" }),
          },
        },
        { reply: "I was denied shell execution." },
      ]
    );

    const models = new ModelRegistry();
    models.register(fakeModel);

    const harness = new RegaHarness({
      events,
      persist: makeHarnessPersist(repos),
      tools,
      models,
      workspaceDir: "/tmp",
    });

    const conversation: Conversation = {
      id: "conv-deny-test",
      agentId: restrictedAgent.id,
      title: "Deny Test",
      userId: "test",
      createdAt: now(),
      updatedAt: now(),
    };

    const userMessage: Message = {
      id: "msg-user-deny",
      conversationId: conversation.id,
      agentId: conversation.agentId,
      role: "user",
      content: "Please delete the root folder",
      attachments: [],
      createdAt: now(),
    };
    messages.set(conversation.id, [userMessage]);

    const task: Task = {
      id: "task-deny-test",
      conversationId: conversation.id,
      messageId: userMessage.id,
      agentId: restrictedAgent.id,
      status: "running",
      steps: [],
      modelCalls: 0,
      toolCalls: 0,
      paused: false,
      createdAt: now(),
    };

    const finishedTask = await harness.run({
      agent: restrictedAgent,
      conversation,
      userMessage,
      task,
    });

    expect(finishedTask.status).toBe("completed");
    expect(finishedTask.toolCalls).toBe(1);
    const step = finishedTask.steps[0]!;
    expect(step.status).toBe("failed");
    expect(step.error).toContain("denied for this agent by policy");
  });

  it("enforces agent approvalTools policy requiring interactive approval before execution", async () => {
    const { repos, messages } = createFullMockRepos();
    const events = new LocalEventBus();
    const tools = new ToolRegistry();

    tools.register({
      id: "custom.action",
      provider: "native",
      description: "Perform sensitive action",
      risk: "R1",
      idempotent: false,
      schema: { type: "object", properties: { target: { type: "string" } } },
      execute: async () => ({ ok: true, data: { status: "action-applied" } }),
    });

    const approvalAgent: Agent = {
      id: "agent-approval-required",
      name: "Careful Agent",
      systemPrompt: "You are a careful agent requiring approval.",
      model: { driver: "openai", model: "fake", temperature: 0.7, imageInput: true },
      permissions: {
        denyTools: [],
        approvalTools: ["custom.action"],
      },
      createdAt: now(),
      updatedAt: now(),
    };

    const fakeModel = new FakeModelDriver(
      { driver: "openai", model: "fake" },
      [
        {
          toolCall: {
            id: "call_sensitive",
            name: "custom.action",
            arguments: JSON.stringify({ target: "production-db" }),
          },
        },
        { reply: "Sensitive action completed after approval." },
      ]
    );

    const models = new ModelRegistry();
    models.register(fakeModel);

    let approvalRequested = false;
    const harness = new RegaHarness({
      events,
      persist: makeHarnessPersist(repos),
      tools,
      models,
      requestApproval: async (req) => {
        approvalRequested = true;
        expect(req.call.name).toBe("custom.action");
        return "approved";
      },
      workspaceDir: "/tmp",
    });

    const conversation: Conversation = {
      id: "conv-appr-test",
      agentId: approvalAgent.id,
      title: "Approval Test",
      userId: "test",
      createdAt: now(),
      updatedAt: now(),
    };

    const userMessage: Message = {
      id: "msg-user-appr",
      conversationId: conversation.id,
      agentId: approvalAgent.id,
      role: "user",
      content: "Modify production database",
      attachments: [],
      createdAt: now(),
    };
    messages.set(conversation.id, [userMessage]);

    const task: Task = {
      id: "task-appr-test",
      conversationId: conversation.id,
      messageId: userMessage.id,
      agentId: approvalAgent.id,
      status: "running",
      steps: [],
      modelCalls: 0,
      toolCalls: 0,
      paused: false,
      createdAt: now(),
    };

    const finishedTask = await harness.run({
      agent: approvalAgent,
      conversation,
      userMessage,
      task,
    });

    expect(approvalRequested).toBe(true);
    expect(finishedTask.status).toBe("completed");
    const step = finishedTask.steps[0]!;
    expect(step.status).toBe("completed");
    expect(step.result).toEqual({ status: "action-applied" });
  });
});

describe("E2E Integration: Multi-Agent Subtask DAGs & Artifact Sharing", () => {
  it("builds multi-tier nested DAG and passes shared artifacts across delegation branches", async () => {
    const { repos, tasks } = createFullMockRepos();

    const coordinatorAgent: Agent = {
      id: "agent-coord",
      name: "Coordinator",
      systemPrompt: "Coordinate tasks",
      model: { driver: "openai", model: "gpt-4o", temperature: 0.7, imageInput: true },
      permissions: { denyTools: [], approvalTools: [] },
      createdAt: now(),
      updatedAt: now(),
    };

    const researcherAgent: Agent = {
      id: "agent-researcher",
      name: "Researcher",
      systemPrompt: "Research data",
      model: { driver: "openai", model: "gpt-4o", temperature: 0.7, imageInput: true },
      permissions: { denyTools: [], approvalTools: [] },
      createdAt: now(),
      updatedAt: now(),
    };

    const reviewerAgent: Agent = {
      id: "agent-reviewer",
      name: "Reviewer",
      systemPrompt: "Review artifacts",
      model: { driver: "openai", model: "gpt-4o", temperature: 0.7, imageInput: true },
      permissions: { denyTools: [], approvalTools: [] },
      createdAt: now(),
      updatedAt: now(),
    };

    await repos.saveAgent(coordinatorAgent);
    await repos.saveAgent(researcherAgent);
    await repos.saveAgent(reviewerAgent);

    const mockKernel: any = {
      repos,
      startRun: vi.fn(async (conv: Conversation, agent: Agent, userMsg: Message, parentTaskId?: string) => {
        const subtask: Task = {
          id: newId("task"),
          conversationId: conv.id,
          messageId: userMsg.id,
          agentId: agent.id,
          status: "completed",
          steps: [],
          modelCalls: 1,
          toolCalls: 0,
          paused: false,
          parentTaskId,
          createdAt: now(),
        };
        tasks.set(subtask.id, subtask);
        if (parentTaskId) {
          const parent = tasks.get(parentTaskId);
          if (parent) {
            parent.subtaskIds = Array.from(new Set([...(parent.subtaskIds ?? []), subtask.id]));
          }
        }
        await repos.saveMessage({
          id: newId("msg"),
          conversationId: conv.id,
          agentId: agent.id,
          role: "assistant",
          content: `Completed subtask: ${userMsg.content}`,
          attachments: [],
          createdAt: now(),
        });
        return subtask;
      }),
      waitForRun: vi.fn(async (taskId: string) => tasks.get(taskId)),
    };

    const delegateTool = createDelegateTool(mockKernel);
    const artifactTools = createArtifactTools(mockKernel);
    const artifactSave = artifactTools[0]!;
    const artifactGet = artifactTools[1]!;

    const rootTaskId = "root-pipeline-task";
    tasks.set(rootTaskId, {
      id: rootTaskId,
      conversationId: "conv-root",
      messageId: "msg-root",
      agentId: coordinatorAgent.id,
      status: "running",
      steps: [],
      modelCalls: 1,
      toolCalls: 0,
      paused: false,
      createdAt: now(),
    });

    // Step 1: Coordinator delegates research to Researcher agent
    const res1 = await delegateTool.execute(
      { agentId: researcherAgent.id, task: "Fetch market trends 2026" },
      { requestId: rootTaskId, agentId: coordinatorAgent.id, conversationId: "conv-root", cwd: "/tmp" }
    );
    expect(res1.ok).toBe(true);

    // Researcher saves shared artifact
    const saveArtifactRes = await artifactSave.execute(
      { key: "market-trends-2026", value: JSON.stringify({ aiGrowth: "340%", confidence: 0.98 }) },
      { requestId: "task-research", agentId: researcherAgent.id, conversationId: "conv-sub-1", cwd: "/tmp" }
    );
    expect(saveArtifactRes.ok).toBe(true);

    // Step 2: Coordinator delegates analysis to Reviewer agent
    const res2 = await delegateTool.execute(
      { agentId: reviewerAgent.id, task: "Validate research findings" },
      { requestId: rootTaskId, agentId: coordinatorAgent.id, conversationId: "conv-root", cwd: "/tmp" }
    );
    expect(res2.ok).toBe(true);

    // Reviewer reads the artifact saved by researcher
    const getArtifactRes = await artifactGet.execute(
      { key: "market-trends-2026" },
      { requestId: "task-review", agentId: reviewerAgent.id, conversationId: "conv-sub-2", cwd: "/tmp" }
    );
    expect(getArtifactRes.ok).toBe(true);
    expect((getArtifactRes.data as any).value).toContain("340%");

    // Verify complete DAG decomposition
    const graph = await getSubtaskDecompositionGraph(mockKernel, rootTaskId);
    expect(graph.length).toBe(3);
    const rootNode = graph.find((n) => n.taskId === rootTaskId);
    expect(rootNode?.subtaskIds.length).toBe(2);
  });
});

describe("E2E Integration: HTTP Route Table & UI Endpoints Verification", () => {
  it("handles disaster recovery export and import routes properly", async () => {
    const { repos, agents } = createFullMockRepos();
    const testAgent: Agent = {
      id: "agent-dr-1",
      name: "Disaster Recovery Agent",
      systemPrompt: "DR Prompt",
      model: { driver: "openai", model: "gpt-4o", temperature: 0.7, imageInput: true },
      permissions: { denyTools: [], approvalTools: [] },
      createdAt: now(),
      updatedAt: now(),
    };
    agents.set(testAgent.id, testAgent);

    const mockKernel: any = {
      repos,
      config: { version: "1.0.0" },
      getSettings: async () => ({ defaultModel: { driver: "openai", model: "gpt-4o" } }),
      maskSettings: (s: any) => s,
      workers: { list: async () => [] },
      tools: new ToolRegistry(),
      oauth: { list: async () => [] },
      mcpManager: { listServers: () => [] },
      memory: { search: async () => [], propose: async () => {} },
      skills: { list: async () => [], get: async () => undefined },
      routines: { list: async () => [], runs: async () => [] },
      refreshSecrets: async () => {},
    };

    const routes = buildHttpRoutes(mockKernel);

    // Test /api/export
    const exportHandler = routes.get.get("/api/export");
    expect(exportHandler).toBeDefined();
    const exportRes = await exportHandler!({} as any);
    expect(exportRes.status).toBe(200);
    const exportData = (exportRes as any).body;
    expect(exportData.version).toBe("1.0.0");
    expect(exportData.data.agents.length).toBe(1);

    // Test /api/import
    const importHandler = routes.post.get("/api/import");
    expect(importHandler).toBeDefined();
    const newAgent: Agent = {
      id: "agent-imported-2",
      name: "Imported Agent 2",
      systemPrompt: "Imported",
      model: { driver: "openai", model: "gpt-4o", temperature: 0.7, imageInput: true },
      permissions: { denyTools: [], approvalTools: [] },
      createdAt: now(),
      updatedAt: now(),
    };
    const importRes = await importHandler!({ body: { data: { agents: [newAgent] } } } as any);
    expect(importRes.status).toBe(200);
    expect((importRes as any).body.imported).toBe(1);
    expect(agents.has("agent-imported-2")).toBe(true);
  });
});

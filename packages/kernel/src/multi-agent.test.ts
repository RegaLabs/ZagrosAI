import { describe, expect, it, vi } from "vitest";
import { newId, now, type Agent, type Conversation, type Message, type Task } from "@zagros/domain";
import {
  createDelegateTool,
  createArtifactTools,
  getSubtaskDecompositionGraph,
} from "./multi-agent.js";

function createMockKernel(agents: Agent[] = [], tasks: Task[] = [], artifacts: Map<string, any> = new Map()) {
  const agentMap = new Map(agents.map((a) => [a.id, a]));
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const convMap = new Map<string, Conversation>();
  const msgMap = new Map<string, Message[]>();

  const kernel: any = {
    repos: {
      getAgent: vi.fn(async (id: string) => agentMap.get(id)),
      listAgents: vi.fn(async () => Array.from(agentMap.values())),
      saveConversation: vi.fn(async (conv: Conversation) => { convMap.set(conv.id, conv); }),
      saveMessage: vi.fn(async (msg: Message) => {
        const list = msgMap.get(msg.conversationId) ?? [];
        list.push(msg);
        msgMap.set(msg.conversationId, list);
      }),
      listMessages: vi.fn(async (convId: string) => msgMap.get(convId) ?? []),
      saveTask: vi.fn(async (task: Task) => { taskMap.set(task.id, task); }),
      getTask: vi.fn(async (id: string) => taskMap.get(id)),
      listTasks: vi.fn(async () => Array.from(taskMap.values())),
      saveArtifact: vi.fn(async (art: any) => { artifacts.set(art.key, art); }),
      getArtifact: vi.fn(async (key: string) => artifacts.get(key)),
      listArtifacts: vi.fn(async () => Array.from(artifacts.values())),
    },
    startRun: vi.fn(async (conv: Conversation, agent: Agent, userMsg: Message, parentTaskId?: string) => {
      const task: Task = {
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
      taskMap.set(task.id, task);
      if (parentTaskId) {
        const parent = taskMap.get(parentTaskId);
        if (parent) {
          parent.subtaskIds = Array.from(new Set([...(parent.subtaskIds ?? []), task.id]));
        }
      }
      const replyMsg: Message = {
        id: newId("msg"),
        conversationId: conv.id,
        agentId: agent.id,
        role: "assistant",
        content: `Subtask output for ${userMsg.content}`,
        attachments: [],
        createdAt: now(),
      };
      const list = msgMap.get(conv.id) ?? [];
      list.push(replyMsg);
      msgMap.set(conv.id, list);
      return task;
    }),
    waitForRun: vi.fn(async (taskId: string) => taskMap.get(taskId)),
  };

  return { kernel, agentMap, taskMap, artifacts, msgMap };
}

describe("Kernel Multi-Agent & Delegation", () => {
  it("delegates task to target agent by agentId and tracks subtask parentTaskId", async () => {
    const targetAgent: Agent = {
      id: "agent-specialist",
      name: "Specialist",
      systemPrompt: "Specialist prompt",
      model: { driver: "openai", model: "gpt-4o", temperature: 0.7, imageInput: true },
      permissions: { denyTools: [], approvalTools: [] },
      createdAt: now(),
      updatedAt: now(),
    };
    const { kernel, taskMap } = createMockKernel([targetAgent]);
    const delegateTool = createDelegateTool(kernel);

    const rootTaskId = "parent-task-123";
    taskMap.set(rootTaskId, {
      id: rootTaskId,
      conversationId: "conv-parent",
      messageId: "msg-parent",
      agentId: "agent-coordinator",
      status: "running",
      steps: [],
      modelCalls: 1,
      toolCalls: 1,
      paused: false,
      createdAt: now(),
    });

    const result = await delegateTool.execute(
      { agentId: "agent-specialist", task: "Perform data validation" },
      { requestId: rootTaskId, agentId: "agent-coordinator", conversationId: "conv-parent", cwd: "/tmp" }
    );

    expect(result.ok).toBe(true);
    const data = result.data as { agentId: string; result: string };
    expect(data.agentId).toBe("agent-specialist");
    expect(data.result).toContain("Subtask output for Perform data validation");

    const parentTask = taskMap.get(rootTaskId);
    expect(parentTask?.subtaskIds?.length).toBe(1);

    const graph = await getSubtaskDecompositionGraph(kernel, rootTaskId);
    expect(graph.length).toBe(2);
    expect(graph[0]?.taskId).toBe(rootTaskId);
    expect(graph[0]?.subtaskIds.length).toBe(1);
    expect(graph[1]?.parentTaskId).toBe(rootTaskId);
  });

  it("delegates task to agent group with load balancing", async () => {
    const agentA: Agent = {
      id: "agent-group-a",
      name: "Group Member A",
      systemPrompt: "A",
      model: { driver: "openai", model: "gpt-4o", temperature: 0.7, imageInput: true },
      permissions: { denyTools: [], approvalTools: [] },
      group: "analysts",
      createdAt: now(),
      updatedAt: now(),
    };
    const agentB: Agent = {
      id: "agent-group-b",
      name: "Group Member B",
      systemPrompt: "B",
      model: { driver: "openai", model: "gpt-4o", temperature: 0.7, imageInput: true },
      permissions: { denyTools: [], approvalTools: [] },
      group: "analysts",
      createdAt: now(),
      updatedAt: now(),
    };
    const { kernel } = createMockKernel([agentA, agentB]);
    const delegateTool = createDelegateTool(kernel);

    const result = await delegateTool.execute(
      { group: "analysts", task: "Analyze metrics" },
      { requestId: "r1", agentId: "a1", conversationId: "c1", cwd: "/tmp" }
    );
    expect(result.ok).toBe(true);
    const data = result.data as { agentId: string };
    expect(data.agentId).toBeDefined();
  });

  it("resolves multi-level and concurrently spawned subtask decomposition graph", async () => {
    const rootTask: Task = {
      id: "root-100",
      conversationId: "conv-root",
      messageId: "msg-root",
      agentId: "agent-lead",
      status: "running",
      steps: [],
      modelCalls: 1,
      toolCalls: 2,
      paused: false,
      subtaskIds: ["child-1"], // recorded subtaskId
      createdAt: now(),
    };
    const child1: Task = {
      id: "child-1",
      conversationId: "conv-c1",
      messageId: "msg-c1",
      agentId: "agent-worker-1",
      parentTaskId: "root-100",
      status: "completed",
      steps: [],
      modelCalls: 1,
      toolCalls: 0,
      paused: false,
      createdAt: now(),
    };
    // child2 was created concurrently with parentTaskId pointing to root-100 but not yet in root's subtaskIds array
    const child2: Task = {
      id: "child-2",
      conversationId: "conv-c2",
      messageId: "msg-c2",
      agentId: "agent-worker-2",
      parentTaskId: "root-100",
      status: "running",
      steps: [],
      modelCalls: 1,
      toolCalls: 0,
      paused: false,
      createdAt: now(),
    };
    // grandchild spawned by child2
    const grandchild: Task = {
      id: "grandchild-1",
      conversationId: "conv-gc",
      messageId: "msg-gc",
      agentId: "agent-worker-3",
      parentTaskId: "child-2",
      status: "completed",
      steps: [],
      modelCalls: 1,
      toolCalls: 0,
      paused: false,
      createdAt: now(),
    };

    const { kernel } = createMockKernel([], [rootTask, child1, child2, grandchild]);

    const graph = await getSubtaskDecompositionGraph(kernel, "root-100");
    expect(graph.length).toBe(4);

    const rootNode = graph.find((n) => n.taskId === "root-100");
    expect(rootNode?.subtaskIds).toContain("child-1");
    expect(rootNode?.subtaskIds).toContain("child-2");

    const child2Node = graph.find((n) => n.taskId === "child-2");
    expect(child2Node?.subtaskIds).toContain("grandchild-1");
  });
});

describe("Kernel Shared Artifacts Tools", () => {
  it("stores and retrieves shared artifacts", async () => {
    const { kernel } = createMockKernel();
    const artifactTools = createArtifactTools(kernel);
    const artifactSave = artifactTools[0]!;
    const artifactGet = artifactTools[1]!;

    const saveResult = await artifactSave.execute(
      { key: "build-config", value: JSON.stringify({ env: "production", version: "0.8.0" }) },
      { requestId: "task-1", agentId: "agent-1", conversationId: "conv-1", cwd: "/tmp" }
    );

    expect(saveResult.ok).toBe(true);
    const saveData = saveResult.data as { stored: boolean };
    expect(saveData.stored).toBe(true);

    const getResult = await artifactGet.execute(
      { key: "build-config" },
      { requestId: "task-2", agentId: "agent-2", conversationId: "conv-2", cwd: "/tmp" }
    );

    expect(getResult.ok).toBe(true);
    const getData = getResult.data as { value: string };
    expect(getData.value).toContain("0.8.0");
  });
});

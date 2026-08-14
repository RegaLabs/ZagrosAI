import { describe, it, expect } from "vitest";
import { newId, now, type Approval, type Memory, type Task, type TaskStep, type Worker } from "@zagros/domain";
import { ApprovalManager } from "./approval-manager.js";
import { MemoryManager } from "./memory.js";
import { LocalEventBus } from "./events.js";
import { WorkerRegistry } from "./worker-registry.js";
import type { Repos } from "@zagros/runtime";

function makeInMemoryRepos(): Repos {
  const approvals = new Map<string, Approval>();
  const memories = new Map<string, Memory>();
  const workers = new Map<string, Worker>();
  return {
    async getApproval(id: string) {
      return approvals.get(id);
    },
    async saveApproval(app: Approval) {
      approvals.set(app.id, app);
    },
    async updateApprovalStatus(id: string, status: Approval["status"], decidedAt: string) {
      const existing = approvals.get(id);
      if (existing) {
        approvals.set(id, { ...existing, status, decidedAt });
      }
    },
    async listApprovals() {
      return [...approvals.values()];
    },
    async getMemory(id: string) {
      return memories.get(id);
    },
    async saveMemory(mem: Memory) {
      memories.set(mem.id, mem);
    },
    async deleteMemory(id: string) {
      memories.delete(id);
    },
    async listMemories() {
      return [...memories.values()];
    },
    async listWorkers() {
      return [...workers.values()];
    },
    async saveWorker(w: Worker) {
      workers.set(w.id, w);
    },
    async appendAudit() {},
  } as unknown as Repos;
}

describe("ApprovalManager", () => {
  it("allows deciding an approval loaded from DB without in-memory pending entry", async () => {
    const repos = makeInMemoryRepos();
    const bus = new LocalEventBus();
    const manager = new ApprovalManager(repos, bus);

    const approval: Approval = {
      id: newId("approval"),
      taskId: "task_1",
      stepId: "step_1",
      toolId: "shell.exec",
      toolArgs: {},
      risk: "R2",
      status: "pending",
      createdAt: now(),
      expiresAt: now(),
    };
    await repos.saveApproval(approval);

    const success = await manager.decide(approval.id, "approved");
    expect(success).toBe(true);

    const updated = await repos.getApproval(approval.id);
    expect(updated?.status).toBe("approved");
  });

  it("cancels pending approvals when task is aborted via cancelPendingForTask", async () => {
    const repos = makeInMemoryRepos();
    const bus = new LocalEventBus();
    const manager = new ApprovalManager(repos, bus, 60_000);

    const task: Task = {
      id: "task_abort_1",
      conversationId: "conv_1",
      messageId: "msg_1",
      agentId: "agent_1",
      status: "running",
      steps: [],
      modelCalls: 0,
      toolCalls: 0,
      paused: false,
      createdAt: now(),
    };
    const step: TaskStep = {
      id: "step_1",
      taskId: task.id,
      kind: "tool",
      status: "running",
      attempts: 1,
      createdAt: now(),
      updatedAt: now(),
    };

    const requestPromise = manager.request(task, step, "http.post", {}, "R2", "Approval required");
    await manager.cancelPendingForTask("task_abort_1");

    const decision = await requestPromise;
    expect(decision).toBe("expired");
  });

  it("handles AbortSignal passed to approval request immediately", async () => {
    const repos = makeInMemoryRepos();
    const bus = new LocalEventBus();
    const manager = new ApprovalManager(repos, bus, 60_000);

    const controller = new AbortController();
    const task: Task = {
      id: "task_abort_2",
      conversationId: "conv_2",
      messageId: "msg_2",
      agentId: "agent_2",
      status: "running",
      steps: [],
      modelCalls: 0,
      toolCalls: 0,
      paused: false,
      createdAt: now(),
    };
    const step: TaskStep = {
      id: "step_2",
      taskId: task.id,
      kind: "tool",
      status: "running",
      attempts: 1,
      createdAt: now(),
      updatedAt: now(),
    };

    const requestPromise = manager.request(task, step, "http.post", {}, "R2", "Approval required", controller.signal);
    controller.abort();

    const decision = await requestPromise;
    expect(decision).toBe("expired");
  });
});

describe("MemoryManager", () => {
  it("proposes and searches memories with coverage ranking", async () => {
    const repos = makeInMemoryRepos();
    const manager = new MemoryManager(repos);

    await manager.propose({
      content: "The user prefers TypeScript over JavaScript for all backend code.",
      kind: "semantic",
      scope: "agent",
      confidence: 0.9,
    });

    const results = await manager.search("user prefers TypeScript for backend");
    expect(results.length).toBe(1);
    expect(results[0]?.content).toContain("TypeScript");
  });

  it("ranks and tokenizes multilingual / Kurdish Unicode terms accurately", async () => {
    const repos = makeInMemoryRepos();
    const manager = new MemoryManager(repos);

    await manager.propose({
      content: "کۆردیناتۆری سیستەم ڕێکخستنی نوێی بۆ پڕۆژەکە پەسەند کرد",
      kind: "semantic",
      scope: "project",
      confidence: 0.95,
    });

    const results = await manager.search("ڕێکخستنی نوێی کۆردیناتۆر", { scope: "project" });
    expect(results.length).toBe(1);
    expect(results[0]?.content).toContain("کۆردیناتۆری");
  });

  it("merges higher confidence updates and filters by scope and kind", async () => {
    const repos = makeInMemoryRepos();
    const manager = new MemoryManager(repos);

    await manager.propose({
      content: "Default deployment target is AWS us-east-1 cluster.",
      kind: "semantic",
      scope: "global",
      confidence: 0.7,
    });

    const mergeResult = await manager.propose({
      content: "Default deployment target is AWS us-east-1 cluster with VPC peering.",
      kind: "semantic",
      scope: "global",
      confidence: 0.95,
      tags: ["infra", "aws"],
    });

    expect(mergeResult.action).toBe("merged");

    const memories = await manager.search("deployment target AWS", { scope: "global", kind: "semantic" });
    expect(memories.length).toBe(1);
    expect(memories[0]?.content).toContain("VPC peering");
    expect(memories[0]?.confidence).toBe(0.95);
  });
});

describe("WorkerRegistry", () => {
  it("terminates prompt streams when runner disconnects", async () => {
    const repos = makeInMemoryRepos();
    const bus = new LocalEventBus();
    const registry = new WorkerRegistry(repos, bus, () => "test-token");

    const messagesSent: string[] = [];
    const mockSocket = {
      send: (msg: string) => messagesSent.push(msg),
      close: () => {},
      onMessage: () => {},
      onClose: (cb: () => void) => {
        closeCb = cb;
      },
    };
    let closeCb: (() => void) | undefined;

    const worker = await registry.handleRunnerConnection(mockSocket as never, {
      type: "hello",
      token: "test-token",
      name: "runner-1",
      os: "linux",
      arch: "x64",
      capabilities: { shell: true, filesystem: true, browser: false, docker: false, gpu: false },
      models: [],
      harnesses: ["acp"],
    });

    expect(worker).toBeDefined();

    const transport = registry.getHarnessTransport();
    const streamPromise = (async () => {
      const events = [];
      for await (const evt of transport.streamPrompt({ harness: "acp", sessionKey: "s1", system: "sys", user: "usr" })) {
        events.push(evt);
      }
      return events;
    })();

    if (closeCb) closeCb();

    await expect(streamPromise).rejects.toThrow(/offline/i);
  });
});

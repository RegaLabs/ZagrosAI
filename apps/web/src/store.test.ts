import { describe, expect, it } from "vitest";
import { formatBytes, timeAgo } from "./format.js";
import { newestLiveTask, useStore } from "./store.js";
import type {
  Approval,
  ApprovalStatus,
  RoutineRun,
  RoutineRunStatus,
  Task,
  TaskStatus,
} from "./types.js";

function makeRoutineRun(
  id: string,
  routineId: string,
  status: RoutineRunStatus
): RoutineRun {
  return {
    id,
    routineId,
    taskId: "task-1",
    status,
    attempts: 1,
    test: false,
    startedAt: "2026-08-13T10:00:00.000Z",
  };
}

function makeTask(
  id: string,
  conversationId: string,
  status: TaskStatus,
  createdAt: string
): Task {
  return {
    id,
    conversationId,
    messageId: "msg-1",
    agentId: "agent-1",
    status,
    paused: false,
    steps: [],
    modelCalls: 0,
    toolCalls: 0,
    createdAt,
  };
}

function makeApproval(id: string, status: ApprovalStatus): Approval {
  return {
    id,
    taskId: "task-1",
    stepId: "step-1",
    conversationId: "conv-1",
    toolId: "shell.run",
    toolArgs: { cmd: "ls" },
    risk: "R2",
    status,
    createdAt: "2026-08-13T10:00:00.000Z",
    expiresAt: "2026-08-13T10:05:00.000Z",
  };
}

describe("format", () => {
  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024 * 2)).toBe("2.0 MB");
  });

  it("formats relative time", () => {
    const now = new Date().toISOString();
    expect(timeAgo(now)).toBe("now");
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(timeAgo(fiveMinutesAgo)).toBe("5m");
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    expect(timeAgo(twoDaysAgo)).toBe("2d");
  });
});

describe("newestLiveTask", () => {
  it("returns the newest live task for a conversation", () => {
    const tasks = [
      makeTask("t1", "conv-1", "completed", "2026-08-13T10:00:00.000Z"),
      makeTask("t2", "conv-1", "running", "2026-08-13T10:05:00.000Z"),
      makeTask("t3", "conv-2", "running", "2026-08-13T10:06:00.000Z"),
    ];
    const live = newestLiveTask(tasks, "conv-1");
    expect(live?.id).toBe("t2");
  });

  it("returns null when no task is live", () => {
    const tasks = [makeTask("t1", "conv-1", "failed", "2026-08-13T10:00:00.000Z")];
    expect(newestLiveTask(tasks, "conv-1")).toBeNull();
  });

  it("returns null when a terminal task is newest", () => {
    const tasks = [
      makeTask("t1", "conv-1", "running", "2026-08-13T10:00:00.000Z"),
      makeTask("t2", "conv-1", "failed", "2026-08-13T10:05:00.000Z"),
    ];
    expect(newestLiveTask(tasks, "conv-1")).toBeNull();
  });
});

describe("handleWsEvent", () => {
  it("prepends approval.requested and replaces on approval.decided", () => {
    const store = useStore.getState();
    store.handleWsEvent({
      type: "approval.requested",
      approval: makeApproval("a1", "pending"),
    });
    let approvals = useStore.getState().approvals;
    expect(approvals[0]?.id).toBe("a1");
    expect(approvals[0]?.status).toBe("pending");

    store.handleWsEvent({
      type: "approval.decided",
      approval: makeApproval("a1", "approved"),
    });
    approvals = useStore.getState().approvals;
    expect(approvals.length).toBe(1);
    expect(approvals[0]?.status).toBe("approved");
  });

  it("prepends connector.connected and removes on connector.removed", () => {
    const store = useStore.getState();
    store.handleWsEvent({
      type: "connector.connected",
      connector: {
        id: "c1",
        provider: "github",
        account: "octocat",
        scopes: ["repo"],
        createdAt: "2026-08-13T10:00:00.000Z",
      },
    });
    let connectors = useStore.getState().connectors;
    expect(connectors[0]?.id).toBe("c1");
    expect(connectors[0]?.providerLabel).toBe("github");

    store.handleWsEvent({
      type: "connector.removed",
      connectorId: "c1",
    });
    connectors = useStore.getState().connectors;
    expect(connectors).toEqual([]);
  });

  it("prepends routine.run and de-duplicates by run id", () => {
    const store = useStore.getState();
    store.handleWsEvent({
      type: "routine.run",
      routineId: "r1",
      run: makeRoutineRun("run-1", "r1", "running"),
    });
    store.handleWsEvent({
      type: "routine.run",
      routineId: "r1",
      run: makeRoutineRun("run-1", "r1", "completed"),
    });
    store.handleWsEvent({
      type: "routine.run",
      routineId: "r2",
      run: makeRoutineRun("run-2", "r2", "failed"),
    });
    const runs = useStore.getState().routineRuns;
    expect(runs.length).toBe(2);
    expect(runs[0]?.id).toBe("run-2");
    expect(runs[0]?.status).toBe("failed");
    const first = runs.find((r) => r.id === "run-1");
    expect(first?.status).toBe("completed");
  });

  it("handles worker online and offline transitions", () => {
    const store = useStore.getState();
    store.handleWsEvent({
      type: "worker.online",
      worker: {
        id: "w1",
        name: "Worker 1",
        os: "linux",
        arch: "x64",
        online: true,
        capabilities: { shell: true, filesystem: true, browser: true, docker: false, gpu: false },
        harnesses: ["codex"],
        lastSeenAt: "2026-08-14T10:00:00.000Z",
      },
    });
    let workers = useStore.getState().workers;
    expect(workers.some((w) => w.id === "w1" && w.online)).toBe(true);

    store.handleWsEvent({
      type: "worker.offline",
      worker: {
        id: "w1",
        name: "Worker 1",
        os: "linux",
        arch: "x64",
        online: false,
        capabilities: { shell: true, filesystem: true, browser: true, docker: false, gpu: false },
        harnesses: ["codex"],
        lastSeenAt: "2026-08-14T10:05:00.000Z",
      },
    });
    workers = useStore.getState().workers;
    expect(workers.find((w) => w.id === "w1")?.online).toBe(false);
  });
});


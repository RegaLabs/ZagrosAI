import { describe, it, expect, vi } from "vitest";
import { newId, now, type Routine, type RoutineRun, type Task } from "@zagros/domain";
import type { Repos } from "@zagros/runtime";
import { LocalEventBus } from "./events.js";
import { RoutineManager, ROUTINE_TASK_EXPIRY_MS } from "./routines.js";

function makeMockRepos(): Repos {
  const routines = new Map<string, Routine>();
  const routineRuns: RoutineRun[] = [];
  const tasks = new Map<string, Task>();
  const audit: Array<{ id: string; type: string; detail?: unknown; createdAt: string }> = [];

  return {
    async listRoutines() {
      return [...routines.values()];
    },
    async getRoutine(id: string) {
      return routines.get(id);
    },
    async saveRoutine(routine: Routine) {
      routines.set(routine.id, routine);
    },
    async deleteRoutine(id: string) {
      routines.delete(id);
    },
    async listRoutineRuns(routineId?: string, limit = 50) {
      let filtered = routineRuns;
      if (routineId) {
        filtered = filtered.filter((r) => r.routineId === routineId);
      }
      return filtered.slice(0, limit);
    },
    async saveRoutineRun(run: RoutineRun) {
      const idx = routineRuns.findIndex((r) => r.id === run.id);
      if (idx >= 0) {
        routineRuns[idx] = run;
      } else {
        routineRuns.push(run);
      }
    },
    async getTask(id: string) {
      return tasks.get(id);
    },
    async saveTask(task: Task) {
      tasks.set(task.id, task);
    },
    async listTasks() {
      return [...tasks.values()];
    },
    async appendAudit(entry: { id: string; type: string; detail?: unknown; createdAt: string }) {
      audit.push(entry);
    },
  } as unknown as Repos;
}

describe("RoutineManager", () => {
  it("creates, updates, and deletes routines", async () => {
    const repos = makeMockRepos();
    const events = new LocalEventBus();
    const manager = new RoutineManager(
      repos,
      events,
      async () => ({ taskId: "task_1" }),
      async () => undefined
    );

    const routine: Routine = {
      id: newId("routine"),
      name: "test-cron",
      description: "cron test",
      trigger: { type: "schedule", cron: "*/5 * * * * *", missedRuns: "run_latest" },
      agentId: "agent_1",
      prompt: "Execute test prompt",
      enabled: true,
      retry: { attempts: 1, backoffMs: 10, deadLetter: true },
      workerRequirements: { capabilities: [], harnesses: [] },
      createdAt: now(),
      updatedAt: now(),
    };

    const created = await manager.create(routine);
    expect(created.nextRunAt).toBeDefined();

    const updated = await manager.update(routine.id, { enabled: false });
    expect(updated?.enabled).toBe(false);
    expect(updated?.nextRunAt).toBeUndefined();

    const deleted = await manager.remove(routine.id);
    expect(deleted).toBe(true);
  });

  it("handles event-triggered routines with payload templating", async () => {
    const repos = makeMockRepos();
    const events = new LocalEventBus();
    let executedPrompt = "";
    const manager = new RoutineManager(
      repos,
      events,
      async (_routine, prompt) => {
        executedPrompt = prompt;
        return { taskId: "task_event" };
      },
      async () => undefined
    );

    const eventRoutine: Routine = {
      id: newId("routine"),
      name: "on-build-failed",
      description: "Triggers on build fail",
      trigger: { type: "event", eventName: "build.failed" },
      agentId: "agent_1",
      prompt: "Alert build failure: {payload.reason}",
      enabled: true,
      retry: { attempts: 0, backoffMs: 10, deadLetter: true },
      workerRequirements: { capabilities: [], harnesses: [] },
      createdAt: now(),
      updatedAt: now(),
    };

    await manager.create(eventRoutine);

    const runs = await manager.triggerEvent("build.failed", { reason: "Syntax error in index.ts" });
    expect(runs.length).toBe(1);
    expect(executedPrompt).toBe("Alert build failure: Syntax error in index.ts");
  });

  it("executes routine in test mode without mutating routine lastRunAt", async () => {
    const repos = makeMockRepos();
    const events = new LocalEventBus();
    const manager = new RoutineManager(
      repos,
      events,
      async () => ({ taskId: "task_test" }),
      async () => undefined
    );

    const routine: Routine = {
      id: newId("routine"),
      name: "manual-test",
      description: "",
      trigger: { type: "manual" },
      agentId: "agent_1",
      prompt: "Run manual test",
      enabled: true,
      retry: { attempts: 0, backoffMs: 10, deadLetter: true },
      workerRequirements: { capabilities: [], harnesses: [] },
      createdAt: now(),
      updatedAt: now(),
    };

    await manager.create(routine);

    const run = await manager.run(routine.id, { test: true });
    expect(run.test).toBe(true);

    const fetched = await manager.get(routine.id);
    expect(fetched?.lastRunAt).toBeUndefined();
  });

  it("flags unmet worker requirements", async () => {
    const repos = makeMockRepos();
    const events = new LocalEventBus();
    const manager = new RoutineManager(
      repos,
      events,
      async () => ({ taskId: "task_browser" }),
      async () => 'Worker requirement unmet: no online Runner has the "browser" capability.'
    );

    const routine: Routine = {
      id: newId("routine"),
      name: "browser-task",
      description: "",
      trigger: { type: "manual" },
      agentId: "agent_1",
      prompt: "Open browser",
      enabled: true,
      retry: { attempts: 0, backoffMs: 10, deadLetter: true },
      workerRequirements: { capabilities: ["browser"], harnesses: [] },
      createdAt: now(),
      updatedAt: now(),
    };

    await manager.create(routine);

    const run = await manager.run(routine.id);
    expect(run.status).toBe("unmet");
    expect(run.error).toContain("browser");
  });

  it("handles retry exhaustion and dead-letter status on task failure", async () => {
    const repos = makeMockRepos();
    const events = new LocalEventBus();
    const manager = new RoutineManager(
      repos,
      events,
      async () => ({ taskId: "task_fail" }),
      async () => undefined
    );

    const routine: Routine = {
      id: newId("routine"),
      name: "retry-failing",
      description: "",
      trigger: { type: "manual" },
      agentId: "agent_1",
      prompt: "Failing prompt",
      enabled: true,
      retry: { attempts: 2, backoffMs: 5, deadLetter: true },
      workerRequirements: { capabilities: [], harnesses: [] },
      createdAt: now(),
      updatedAt: now(),
    };

    await manager.create(routine);
    const run = await manager.run(routine.id);

    // Simulate task terminal failure for attempt 1 and attempt 2 (retry exhaustion)
    await manager.onTaskTerminal({ id: "task_fail", status: "failed", error: "Model timeout error" });
    await manager.onTaskTerminal({ id: "task_fail", status: "failed", error: "Model timeout error" });

    const runs = await manager.runs(routine.id);
    const lastRun = runs[runs.length - 1];
    expect(lastRun?.status).toBe("deadletter");
  });

  it("sweeps expired queued or running routine tasks", async () => {
    const repos = makeMockRepos();
    const events = new LocalEventBus();
    const manager = new RoutineManager(
      repos,
      events,
      async () => ({ taskId: "task_expired" }),
      async () => undefined
    );

    const oldTimestamp = new Date(Date.now() - (ROUTINE_TASK_EXPIRY_MS + 10000)).toISOString();
    const run: RoutineRun = {
      id: "rrun_old",
      routineId: "routine_1",
      taskId: "task_expired",
      status: "running",
      attempts: 1,
      test: false,
      startedAt: oldTimestamp,
    };
    await repos.saveRoutineRun(run);

    const task: Task = {
      id: "task_expired",
      conversationId: "conv_1",
      messageId: "msg_1",
      agentId: "agent_1",
      status: "running",
      steps: [],
      modelCalls: 1,
      toolCalls: 0,
      paused: false,
      createdAt: oldTimestamp,
    };
    await repos.saveTask(task);

    await manager.sweepExpired();

    const updatedTask = await repos.getTask("task_expired");
    expect(updatedTask?.status).toBe("failed");
    expect(updatedTask?.error).toContain("expired");

    const runs = await repos.listRoutineRuns("routine_1");
    const updatedRun = runs.find((r) => r.id === "rrun_old");
    expect(updatedRun?.status).toBe("failed");
    expect(updatedRun?.error).toContain("expired");
  });

  it("supports deeply nested payload templating in prompts", async () => {
    const repos = makeMockRepos();
    const events = new LocalEventBus();
    let executedPrompt = "";
    const manager = new RoutineManager(
      repos,
      events,
      async (_routine, prompt) => {
        executedPrompt = prompt;
        return { taskId: "task_nested" };
      },
      async () => undefined
    );

    const routine: Routine = {
      id: newId("routine"),
      name: "nested-template",
      description: "",
      trigger: { type: "event", eventName: "github.pr.opened" },
      agentId: "agent_1",
      prompt: "Review PR #{payload.pr.number} by {payload.pr.author.login}: {payload.pr.title}",
      enabled: true,
      retry: { attempts: 0, backoffMs: 10, deadLetter: true },
      workerRequirements: { capabilities: [], harnesses: [] },
      createdAt: now(),
      updatedAt: now(),
    };

    await manager.create(routine);

    const runs = await manager.triggerEvent("github.pr.opened", {
      pr: {
        number: 42,
        title: "Add Cloudflare Durable Object alarms",
        author: { login: "octocat" },
      },
    });

    expect(runs.length).toBe(1);
    expect(executedPrompt).toBe("Review PR #42 by octocat: Add Cloudflare Durable Object alarms");
  });

  it("triggers routines with wildcard event patterns", async () => {
    const repos = makeMockRepos();
    const events = new LocalEventBus();
    let executedCount = 0;
    const manager = new RoutineManager(
      repos,
      events,
      async () => {
        executedCount++;
        return { taskId: "task_wildcard" };
      },
      async () => undefined
    );

    const wildcardRoutine: Routine = {
      id: newId("routine"),
      name: "wildcard-routine",
      description: "",
      trigger: { type: "event", eventName: "deploy.*" },
      agentId: "agent_1",
      prompt: "Deploy event fired: {payload}",
      enabled: true,
      retry: { attempts: 0, backoffMs: 10, deadLetter: true },
      workerRequirements: { capabilities: [], harnesses: [] },
      createdAt: now(),
      updatedAt: now(),
    };

    await manager.create(wildcardRoutine);

    await manager.triggerEvent("deploy.staging", { env: "staging" });
    await manager.triggerEvent("deploy.production", { env: "prod" });
    await manager.triggerEvent("build.staging", { env: "staging" });

    expect(executedCount).toBe(2);
  });

  it("advances nextRunAt properly after executing due schedules", async () => {
    const repos = makeMockRepos();
    const events = new LocalEventBus();
    let runsCount = 0;
    const manager = new RoutineManager(
      repos,
      events,
      async () => {
        runsCount++;
        return { taskId: `task_due_${runsCount}` };
      },
      async () => undefined
    );

    const pastIso = new Date(Date.now() - 60000).toISOString();
    const scheduledRoutine: Routine = {
      id: newId("routine"),
      name: "cron-due",
      description: "",
      trigger: { type: "schedule", cron: "*/5 * * * * *", missedRuns: "run_latest" },
      agentId: "agent_1",
      prompt: "Execute scheduled task",
      enabled: true,
      retry: { attempts: 0, backoffMs: 10, deadLetter: true },
      workerRequirements: { capabilities: [], harnesses: [] },
      nextRunAt: pastIso,
      createdAt: now(),
      updatedAt: now(),
    };

    await repos.saveRoutine(scheduledRoutine);

    await manager.runDue();
    expect(runsCount).toBe(1);

    const updated = await manager.get(scheduledRoutine.id);
    expect(updated?.nextRunAt).toBeDefined();
    expect(Date.parse(updated!.nextRunAt!)).toBeGreaterThan(Date.now());
  });
});


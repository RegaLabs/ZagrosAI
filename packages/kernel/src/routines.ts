import cronParser from "cron-parser";

interface CronResult {
  next(): { toDate(): Date; toISOString(): string };
}

const { parseExpression } = cronParser as unknown as {
  parseExpression: (expr: string, opts?: unknown) => CronResult;
};
import { newId, now, type Routine, type RoutineRun, type RoutineRunStatus } from "@zagros/domain";
import type { Repos } from "@zagros/runtime";
import type { LocalEventBus } from "./events.js";

export const ROUTINE_TASK_EXPIRY_MS = 45 * 60 * 1000;
const BACKFILL_CAP = 3;

export interface RoutineRunOptions {
  payload?: Record<string, unknown>;
  test?: boolean;
  manual?: boolean;
  attempt?: number;
}

export class RoutineManager {
  private activeEventTriggers = new Set<string>();

  constructor(
    private readonly repos: Repos,
    private readonly events: LocalEventBus,
    private readonly startTask: (routine: Routine, prompt: string) => Promise<{ taskId: string }>,
    private readonly checkRequirements: (routine: Routine) => Promise<string | undefined>
  ) {
    this.events.subscribe((event) => {
      if (
        !event.type.startsWith("routine.") &&
        !event.type.startsWith("task.") &&
        !event.type.startsWith("step.") &&
        !event.type.startsWith("tool.") &&
        !event.type.startsWith("approval.")
      ) {
        const payload = {
          ...(typeof event === "object" && event !== null ? (event as Record<string, unknown>) : {}),
          event,
        };
        void this.triggerEvent(event.type, payload).catch(() => undefined);
      }
    });
  }

  async list(): Promise<Routine[]> {
    return this.repos.listRoutines();
  }

  async get(id: string): Promise<Routine | undefined> {
    return this.repos.getRoutine(id);
  }

  async create(routine: Routine): Promise<Routine> {
    if (routine.trigger.type === "schedule") {
      routine.nextRunAt = this.nextCronRun(routine.trigger.cron, undefined);
    }
    await this.repos.saveRoutine(routine);
    await this.repos.appendAudit({ id: newId("audit"), type: "routine.created", detail: { name: routine.name }, createdAt: now() });
    return routine;
  }

  async update(id: string, patch: Partial<Routine>): Promise<Routine | undefined> {
    const existing = await this.repos.getRoutine(id);
    if (!existing) return undefined;
    const updated: Routine = { ...existing, ...patch, id, updatedAt: now() };
    if (updated.trigger.type === "schedule" && (patch.trigger !== undefined || patch.enabled !== undefined)) {
      updated.nextRunAt = updated.enabled ? this.nextCronRun(updated.trigger.cron, undefined) : undefined;
    }
    await this.repos.saveRoutine(updated);
    await this.repos.appendAudit({ id: newId("audit"), type: "routine.updated", detail: { name: updated.name }, createdAt: now() });
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    const existing = await this.repos.getRoutine(id);
    if (!existing) return false;
    await this.repos.deleteRoutine(id);
    await this.repos.appendAudit({ id: newId("audit"), type: "routine.deleted", detail: { name: existing.name }, createdAt: now() });
    return true;
  }

  async runs(routineId?: string, limit = 50): Promise<RoutineRun[]> {
    return this.repos.listRoutineRuns(routineId, limit);
  }

  async triggerEvent(eventName: string, payload: Record<string, unknown> = {}): Promise<RoutineRun[]> {
    const triggerKey = `${eventName}:${JSON.stringify(payload).slice(0, 100)}`;
    if (this.activeEventTriggers.has(triggerKey)) {
      return [];
    }
    this.activeEventTriggers.add(triggerKey);
    try {
      const routines = await this.repos.listRoutines();
      const matching = routines.filter(
        (r) => r.enabled && r.trigger.type === "event" && this.matchesEvent(r.trigger.eventName, eventName)
      );
      const runs: RoutineRun[] = [];
      for (const routine of matching) {
        const run = await this.run(routine.id, { payload });
        runs.push(run);
      }
      return runs;
    } finally {
      this.activeEventTriggers.delete(triggerKey);
    }
  }

  private matchesEvent(pattern: string, eventName: string): boolean {
    if (pattern === eventName || pattern === "*") return true;
    if (pattern.endsWith(".*")) {
      const prefix = pattern.slice(0, -2);
      return eventName === prefix || eventName.startsWith(`${prefix}.`);
    }
    return false;
  }

  async runDue(): Promise<void> {
    const routines = await this.repos.listRoutines();
    const timestamp = Date.now();
    for (const routine of routines) {
      if (!routine.enabled || routine.trigger.type !== "schedule") continue;
      if (!routine.nextRunAt) {
        routine.nextRunAt = this.nextCronRun(routine.trigger.cron, undefined);
        await this.repos.saveRoutine(routine);
        continue;
      }
      const scheduledTime = Date.parse(routine.nextRunAt);
      if (isNaN(scheduledTime) || scheduledTime > timestamp) continue;

      const interval = Math.max(1000, this.cronIntervalMs(routine.trigger.cron));
      const missed = Math.floor((timestamp - scheduledTime) / interval);

      if (routine.trigger.missedRuns === "skip") {
        const fresh = await this.repos.getRoutine(routine.id);
        if (!fresh || fresh.trigger.type !== "schedule") continue;
        fresh.nextRunAt = this.nextCronRun(fresh.trigger.cron, undefined);
        await this.repos.saveRoutine(fresh);
        continue;
      }

      const runsToDo =
        routine.trigger.missedRuns === "backfill" ? Math.min(Math.max(missed, 1), BACKFILL_CAP) : 1;

      for (let i = 0; i < runsToDo; i++) {
        await this.run(routine.id, {});
      }

      const fresh = await this.repos.getRoutine(routine.id);
      if (fresh && fresh.trigger.type === "schedule" && fresh.enabled) {
        fresh.nextRunAt = this.nextCronRun(fresh.trigger.cron, undefined);
        await this.repos.saveRoutine(fresh);
      }
    }
  }

  async run(routineId: string, options: RoutineRunOptions = {}): Promise<RoutineRun> {
    const routine = await this.repos.getRoutine(routineId);
    if (!routine) throw new Error(`Routine not found: ${routineId}`);
    const payload = options.payload ?? {};
    const prompt = this.renderPrompt(routine, payload);
    const run: RoutineRun = {
      id: newId("rrun"),
      routineId: routine.id,
      taskId: "",
      status: "queued",
      attempts: options.attempt ?? 0,
      payload,
      test: options.test ?? false,
      startedAt: now(),
    };

    const requirementError = await this.checkRequirements(routine);
    if (requirementError) {
      run.status = "unmet";
      run.error = requirementError;
      run.finishedAt = now();
      routine.lastStatus = "unmet";
      routine.lastRunAt = now();
      if (!run.test) {
        await this.repos.saveRoutine(routine);
      }
      await this.repos.saveRoutineRun(run);
      this.events.emit({ type: "routine.run", routineId: routine.id, run });
      return run;
    }

    await this.repos.saveRoutineRun(run);
    this.events.emit({ type: "routine.run", routineId: routine.id, run });

    const maxAttempts = Math.max(routine.retry.attempts, 1);
    const startAttempt = Math.max(options.attempt ?? 1, 1);
    let finalStatus: RoutineRunStatus | undefined;
    let lastError: string | undefined;
    for (let attempt = startAttempt; attempt <= maxAttempts; attempt++) {
      run.attempts = attempt;
      run.status = "running";
      await this.repos.saveRoutineRun(run);
      try {
        const { taskId } = await this.startTask(routine, prompt);
        run.taskId = taskId;
        await this.repos.saveRoutineRun(run);
        finalStatus = undefined;
        lastError = undefined;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < maxAttempts) {
          const backoff = Math.min(routine.retry.backoffMs * Math.pow(2, attempt - 1), 60_000);
          await new Promise((r) => setTimeout(r, backoff));
        } else {
          finalStatus = "failed";
        }
      }
    }

    if (finalStatus === undefined) {
      this.events.emit({ type: "routine.run", routineId: routine.id, run });
      return run;
    }
    if (finalStatus === "failed" && routine.retry.deadLetter && (lastError ?? "") !== "") {
      finalStatus = "deadletter";
    }
    run.status = finalStatus;
    run.error = lastError;
    run.finishedAt = now();
    await this.repos.saveRoutineRun(run);
    routine.lastStatus = finalStatus as Routine["lastStatus"];
    routine.lastRunAt = now();
    if (!run.test) {
      await this.repos.saveRoutine(routine);
      await this.repos.appendAudit({
        id: newId("audit"),
        type: `routine.${finalStatus}`,
        detail: { name: routine.name, error: lastError },
        createdAt: now(),
      });
    }
    this.events.emit({ type: "routine.run", routineId: routine.id, run });
    return run;
  }

  async nextWakeup(): Promise<string | undefined> {
    const routines = await this.repos.listRoutines();
    let earliest: string | undefined;
    for (const routine of routines) {
      if (!routine.enabled || routine.trigger.type !== "schedule") continue;
      if (!routine.nextRunAt) continue;
      if (isNaN(Date.parse(routine.nextRunAt))) continue;
      if (!earliest || Date.parse(routine.nextRunAt) < Date.parse(earliest)) {
        earliest = routine.nextRunAt;
      }
    }
    return earliest;
  }

  async onTaskTerminal(task: { id: string; status: string; error?: string }): Promise<void> {
    const runs = await this.repos.listRoutineRuns(undefined, 200);
    const run = runs.filter((r) => r.taskId === task.id).at(-1);
    if (!run) return;
    if (run.status === "completed" || run.status === "deadletter" || run.status === "unmet") return;
    const routine = await this.repos.getRoutine(run.routineId);
    if (!routine) return;
    if (task.status === "completed") {
      run.status = "completed";
      run.finishedAt = now();
      await this.repos.saveRoutineRun(run);
      routine.lastStatus = "completed";
      routine.lastRunAt = now();
      if (!run.test) {
        await this.repos.saveRoutine(routine);
      }
      this.events.emit({ type: "routine.run", routineId: routine.id, run });
      return;
    }
    const maxAttempts = Math.max(routine.retry.attempts, 1);
    if (run.attempts < maxAttempts) {
      run.status = "failed";
      run.finishedAt = now();
      run.error = task.error;
      await this.repos.saveRoutineRun(run);
      const backoff = Math.min(routine.retry.backoffMs * Math.pow(2, run.attempts - 1), 60_000);
      await new Promise((r) => setTimeout(r, backoff));
      await this.run(routine.id, { payload: run.payload, test: run.test, attempt: run.attempts + 1 });
      return;
    }
    run.status = routine.retry.deadLetter ? "deadletter" : "failed";
    run.error = task.error;
    run.finishedAt = now();
    await this.repos.saveRoutineRun(run);
    routine.lastStatus = run.status;
    routine.lastRunAt = now();
    if (!run.test) {
      await this.repos.saveRoutine(routine);
      await this.repos.appendAudit({
        id: newId("audit"),
        type: `routine.${run.status}`,
        detail: { name: routine.name, error: task.error },
        createdAt: now(),
      });
    }
    this.events.emit({ type: "routine.run", routineId: routine.id, run });
  }

  async sweepExpired(): Promise<void> {
    const runs = await this.repos.listRoutineRuns(undefined, 200);
    const currentTime = Date.now();
    for (const run of runs) {
      if (run.status !== "queued" && run.status !== "running") continue;
      const started = Date.parse(run.startedAt);
      if (isNaN(started) || currentTime - started <= ROUTINE_TASK_EXPIRY_MS) continue;
      run.status = "failed";
      run.error = "Routine run expired after 45 minutes.";
      run.finishedAt = now();
      await this.repos.saveRoutineRun(run);

      if (run.taskId) {
        const task = await this.repos.getTask(run.taskId);
        if (task && (task.status === "queued" || task.status === "running")) {
          task.status = "failed";
          task.error = "Routine run expired after 45 minutes.";
          task.completedAt = now();
          await this.repos.saveTask(task);
          this.events.emit({ type: "task.updated", task: JSON.parse(JSON.stringify(task)) });
        }
      }
    }
  }

  private getNestedValue(obj: unknown, path: string): unknown {
    if (obj === null || obj === undefined) return undefined;
    const parts = path.split(".");
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== "object") {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  private renderPrompt(routine: Routine, payload: Record<string, unknown>): string {
    let prompt = routine.prompt;
    if (prompt.includes("{payload}")) {
      prompt = prompt.replace(/\{payload\}/g, JSON.stringify(payload));
    }
    prompt = prompt.replace(/\{payload\.([a-zA-Z0-9_$]+(?:\.[a-zA-Z0-9_$]+)*)\}/g, (match, path) => {
      const val = this.getNestedValue(payload, path);
      if (val === undefined) return match;
      return typeof val === "object" && val !== null ? JSON.stringify(val) : String(val);
    });
    for (const [key, val] of Object.entries(payload)) {
      const placeholder = `{payload.${key}}`;
      if (prompt.includes(placeholder)) {
        const valStr = typeof val === "object" && val !== null ? JSON.stringify(val) : String(val);
        prompt = prompt.split(placeholder).join(valStr);
      }
    }
    if (routine.skill && !prompt.startsWith(`/${routine.skill}`)) {
      prompt = `/${routine.skill} ${prompt}`;
    }
    return prompt;
  }

  private nextCronRun(cron: string, from: string | undefined): string | undefined {
    try {
      const baseDate = from && !isNaN(Date.parse(from)) && Date.parse(from) > Date.now()
        ? new Date(Date.parse(from))
        : new Date();
      const expression = parseExpression(cron, { currentDate: baseDate });
      return expression.next().toISOString();
    } catch {
      return undefined;
    }
  }

  private cronIntervalMs(cron: string): number {
    try {
      const a = parseExpression(cron, { currentDate: new Date() });
      const next = a.next().toDate().getTime();
      const after = a.next().toDate().getTime();
      return Math.max(1000, after - next);
    } catch {
      return 60_000;
    }
  }
}


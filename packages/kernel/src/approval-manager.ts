import { newId, now, type Approval, type ApprovalStatus, type Task, type TaskStep } from "@zagros/domain";
import type { LocalEventBus } from "./events.js";
import type { Repos } from "@zagros/runtime";

const DEFAULT_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

export class ApprovalManager {
  private readonly pending = new Map<
    string,
    { resolve: (d: ApprovalStatus) => void; timer: ReturnType<typeof setTimeout>; taskId: string }
  >();

  constructor(
    private readonly repos: Repos,
    private readonly events: LocalEventBus,
    private readonly timeoutMs = DEFAULT_APPROVAL_TIMEOUT_MS,
    private readonly onRequested?: (approval: Approval) => void
  ) {}

  request(
    task: Task,
    step: TaskStep,
    toolId: string,
    toolArgs: Record<string, unknown>,
    risk: Approval["risk"],
    reason?: string,
    signal?: AbortSignal
  ): Promise<ApprovalStatus> {
    const approvalId = newId("approval");
    const approval: Approval = {
      id: approvalId,
      taskId: task.id,
      stepId: step.id,
      conversationId: task.conversationId,
      toolId,
      toolArgs,
      risk: risk ?? "R2",
      reason,
      status: "pending",
      createdAt: now(),
      expiresAt: new Date(Date.now() + this.timeoutMs).toISOString(),
    };

    return new Promise<ApprovalStatus>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const onAbort = () => {
        void this.decide(approvalId, "expired");
      };

      timer = setTimeout(() => {
        if (signal) signal.removeEventListener("abort", onAbort);
        void this.decide(approvalId, "expired");
      }, this.timeoutMs);

      const unref = (timer as { unref?: () => void }).unref;
      if (unref) unref.call(timer);

      if (signal) {
        if (signal.aborted) {
          clearTimeout(timer);
          void this.decide(approvalId, "expired");
          resolve("expired");
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      this.pending.set(approvalId, {
        resolve: (d: ApprovalStatus) => {
          if (signal) signal.removeEventListener("abort", onAbort);
          resolve(d);
        },
        timer,
        taskId: task.id,
      });

      void this.repos
        .saveApproval(approval)
        .then(() => {
          this.events.emit({ type: "approval.requested", approval });
          this.onRequested?.(approval);
        })
        .catch(() => {
          // best-effort persistence
        });
    });
  }

  async decide(id: string, decision: ApprovalStatus): Promise<boolean> {
    if (decision === "pending") return false;
    const entry = this.pending.get(id);
    if (entry) {
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.resolve(decision);
    }
    const approval = await this.repos.getApproval(id);
    if (!approval) return false;
    if (approval.status !== "pending") {
      return approval.status === decision;
    }
    const decidedAt = now();
    await this.repos.updateApprovalStatus(id, decision, decidedAt);
    const updated = await this.repos.getApproval(id);
    if (updated) {
      this.events.emit({ type: "approval.decided", approval: updated });
    }
    return true;
  }

  async cancelPendingForTask(taskId: string): Promise<void> {
    const matching: string[] = [];
    for (const [id, entry] of this.pending.entries()) {
      if (entry.taskId === taskId) matching.push(id);
    }
    for (const id of matching) {
      await this.decide(id, "expired");
    }
  }

  async list(taskId?: string, limit = 50): Promise<Approval[]> {
    return this.repos.listApprovals(taskId, limit);
  }
}

import { useState } from "react";
import { t } from "../i18n.js";
import type { Lang } from "../i18n.js";
import { useStore } from "../store.js";
import type { StepStatus, Task, TaskStep, TaskStatus } from "../types.js";
import {
  IconAlert,
  IconCheck,
  IconChevron,
  IconClock,
  IconDot,
  IconRefresh,
} from "./Icons.js";

export function statusLabel(lang: Lang, status: TaskStatus): string {
  switch (status) {
    case "running":
      return t(lang, "status.running");
    case "completed":
      return t(lang, "status.completed");
    case "failed":
      return t(lang, "status.failed");
    default:
      return status.replace(/_/g, " ");
  }
}

function stepLabel(step: TaskStep): string {
  switch (step.kind) {
    case "model":
      return step.objective ? `model — ${step.objective}` : "model call";
    case "tool":
      return `tool ${step.toolId ?? ""}`;
    case "verify":
      return step.objective ? `verify — ${step.objective}` : "verify";
  }
}

function stepIcon(status: StepStatus) {
  switch (status) {
    case "running":
      return <IconClock size={14} className="step-icon-clock" />;
    case "completed":
      return <IconCheck size={14} className="step-icon-ok" />;
    case "failed":
      return <IconAlert size={14} className="step-icon-bad" />;
    case "skipped":
      return <IconDot size={12} className="step-icon-skip" />;
    case "pending":
      return <IconDot size={12} className="step-icon-idle" />;
  }
}

interface Props {
  task: Task;
  onCancel?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onRefresh?: () => void;
}

const CANCELLABLE = [
  "queued",
  "running",
  "waiting_for_tool",
  "waiting_for_approval",
  "verifying",
];

const TERMINAL: TaskStatus[] = [
  "completed",
  "failed",
  "cancelled",
  "expired",
  "blocked",
];

export function TaskCard({ task, onCancel, onPause, onResume, onRefresh }: Props) {
  const lang = useStore((s) => s.lang);
  const [openSteps, setOpenSteps] = useState<Record<string, boolean>>({});
  const cancellable = CANCELLABLE.includes(task.status);
  const toggleStep = (id: string) =>
    setOpenSteps((prev) => ({ ...prev, [id]: !prev[id] }));

  const renderDetail = (step: TaskStep) => {
    const opened = openSteps[step.id] === true;
    if (!opened) return null;
    return (
      <div className="step-detail">
        {step.toolArgs !== undefined && (
          <pre>{JSON.stringify(step.toolArgs, null, 2)}</pre>
        )}
        {step.result !== undefined && (
          <pre>{JSON.stringify(step.result, null, 2).slice(0, 2000)}</pre>
        )}
        {step.error && <p className="step-error">{step.error}</p>}
        {step.toolArgs === undefined && step.result === undefined && !step.error && (
          <p className="step-error">no detail</p>
        )}
      </div>
    );
  };

  return (
    <section className="task-card glass" aria-label={`Task ${task.status}`}>
      <header className="task-card-header">
        <span className={`badge badge-${task.status}`}>
          {statusLabel(lang, task.status)}
        </span>
        {task.paused && !TERMINAL.includes(task.status) && (
          <span className="badge badge-paused">{t(lang, "status.paused")}</span>
        )}
        <span className="task-meta">
          {task.modelCalls} model · {task.toolCalls} tool
        </span>
        <span className="task-card-actions">
          {onRefresh && (
            <button
              className="icon-btn"
              aria-label="Refresh task"
              onClick={onRefresh}
            >
              <IconRefresh size={14} />
            </button>
          )}
          {cancellable && task.paused && onResume && (
            <button className="btn btn-sm" onClick={onResume}>
              Resume
            </button>
          )}
          {cancellable && !task.paused && onPause && (
            <button className="btn btn-sm" onClick={onPause}>
              Pause
            </button>
          )}
          {cancellable && onCancel && (
            <button className="btn btn-danger btn-sm" onClick={onCancel}>
              Cancel
            </button>
          )}
        </span>
      </header>
      {task.error && <p className="task-error">{task.error}</p>}
      {task.steps.length > 0 && (
        <ul className="steps">
          {task.steps.map((step) => {
            const opened = openSteps[step.id] === true;
            return (
              <li key={step.id} className="step">
                <span className="step-icon">{stepIcon(step.status)}</span>
                <div className="step-body">
                  <span className="step-label">{stepLabel(step)}</span>
                  <button
                    className="step-toggle"
                    onClick={() => toggleStep(step.id)}
                    aria-expanded={opened}
                  >
                    <IconChevron size={12} className={opened ? "open" : ""} />
                    {opened ? "hide" : "details"}
                  </button>
                  {renderDetail(step)}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

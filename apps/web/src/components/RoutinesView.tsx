import { useEffect, useState } from "react";
import { timeAgo, timeUntil } from "../format.js";
import { useStore } from "../store.js";
import type { Routine, RoutineRun, RoutineRunStatus } from "../types.js";
import {
  IconChevron,
  IconClock,
  IconPencil,
  IconPlay,
  IconPlus,
  IconTrash,
} from "./Icons.js";
import { RoutineForm } from "./RoutineForm.js";

function describeCron(cron: string): string | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length === 6) {
    const [sec = "", min = "", hour = "", dom = "", mon = "", dow = ""] =
      fields;
    if (
      (sec === "*" || sec === "*/1") &&
      min === "*" &&
      hour === "*" &&
      dom === "*" &&
      mon === "*" &&
      dow === "*"
    ) {
      return "every second";
    }
    const secMatch = /^\*\/(\d+)$/.exec(sec);
    if (
      secMatch &&
      min === "*" &&
      hour === "*" &&
      dom === "*" &&
      mon === "*" &&
      dow === "*"
    ) {
      return `every ${secMatch[1] ?? ""} seconds`;
    }
    if (sec === "0") {
      const minMatch = /^\*\/(\d+)$/.exec(min);
      if (
        minMatch &&
        hour === "*" &&
        dom === "*" &&
        mon === "*" &&
        dow === "*"
      ) {
        return `every ${minMatch[1] ?? ""} minutes`;
      }
    }
  }
  if (fields.length === 5) {
    const [min = "", hour = "", dom = "", mon = "", dow = ""] = fields;
    if (
      (min === "*" || min === "*/1") &&
      hour === "*" &&
      dom === "*" &&
      mon === "*" &&
      dow === "*"
    ) {
      return "every minute";
    }
    const minMatch = /^\*\/(\d+)$/.exec(min);
    if (
      minMatch &&
      hour === "*" &&
      dom === "*" &&
      mon === "*" &&
      dow === "*"
    ) {
      return `every ${minMatch[1] ?? ""} minutes`;
    }
    if (min === "0" && hour !== "*") {
      const hourMatch = /^\*\/(\d+)$/.exec(hour);
      if (
        hourMatch &&
        dom === "*" &&
        mon === "*" &&
        dow === "*"
      ) {
        return `every ${hourMatch[1] ?? ""} hours`;
      }
    }
    if (min === "0" && hour === "0" && dom !== "*") {
      const domMatch = /^\*\/(\d+)$/.exec(dom);
      if (domMatch && mon === "*" && dow === "*") {
        return `every ${domMatch[1] ?? ""} days`;
      }
    }
  }
  return null;
}

function triggerLabel(routine: Routine): string {
  if (routine.trigger.type === "schedule") {
    const human = describeCron(routine.trigger.cron);
    return human
      ? `${human} · cron ${routine.trigger.cron}`
      : `cron ${routine.trigger.cron}`;
  }
  if (routine.trigger.type === "webhook") {
    return `webhook: ${routine.trigger.path}`;
  }
  return "manual";
}

function runStatusLabel(status: RoutineRunStatus): string {
  if (status === "deadletter") return "dead letter";
  return status;
}

function RoutineCard({
  routine,
  runs,
  agentName,
  expanded,
  busy,
  error,
  onToggleEnabled,
  onAct,
  onEdit,
  onDelete,
  onToggleRuns,
}: {
  routine: Routine;
  runs: RoutineRun[];
  agentName: string;
  expanded: boolean;
  busy: { id: string; kind: "run" | "test" } | null;
  error: string | null;
  onToggleEnabled: () => void;
  onAct: (kind: "run" | "test") => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleRuns: () => void;
}) {
  const newestRun = runs[0];
  const liveRun =
    newestRun &&
    (newestRun.status === "queued" || newestRun.status === "running")
      ? newestRun
      : undefined;
  const statusClass = liveRun
    ? `badge-${liveRun.status}`
    : routine.lastStatus
      ? `badge-${routine.lastStatus}`
      : "badge-never";
  const statusLabel = liveRun
    ? runStatusLabel(liveRun.status)
    : (routine.lastStatus ?? "never");

  return (
    <li className="routine-card glass">
      <div className="routine-card-top">
        <div className="routine-heading">
          <span className="routine-name">{routine.name}</span>
          {!routine.enabled && <span className="badge badge-paused">paused</span>}
        </div>
        <button
          role="switch"
          aria-checked={routine.enabled}
          aria-label={`Toggle routine ${routine.name}`}
          className={`switch ${routine.enabled ? "on" : ""}`}
          onClick={onToggleEnabled}
        />
      </div>
      {routine.description && (
        <p className="routine-desc">{routine.description}</p>
      )}
      <div className="chip-row">
        <span className="chip">{triggerLabel(routine)}</span>
        <span className="chip">{agentName}</span>
        {routine.skill && <span className="chip">skill: {routine.skill}</span>}
        {routine.workerRequirements.capabilities.length > 0 && (
          <span className="chip">
            {routine.workerRequirements.capabilities.join(", ")}
          </span>
        )}
      </div>
      <div className="routine-meta">
        {routine.nextRunAt && (
          <span className="routine-next">next {timeUntil(routine.nextRunAt)}</span>
        )}
        <span className={`badge ${liveRun ? "badge-live" : ""} ${statusClass}`}>
          {statusLabel}
        </span>
        {routine.lastRunAt && (
          <span className="routine-time">last {timeAgo(routine.lastRunAt)}</span>
        )}
      </div>
      <div className="routine-actions">
        <button
          className="btn btn-sm"
          disabled={busy !== null}
          onClick={() => onAct("run")}
        >
          <IconPlay size={13} />
          {busy?.kind === "run" ? "Running…" : "Run now"}
        </button>
        <button
          className="btn btn-sm"
          disabled={busy !== null}
          onClick={() => onAct("test")}
        >
          {busy?.kind === "test" ? "Testing…" : "Test"}
        </button>
        <button className="btn btn-sm" onClick={onEdit}>
          <IconPencil size={13} />
          Edit
        </button>
        <button className="btn btn-sm btn-danger" onClick={onDelete}>
          <IconTrash size={13} />
          Delete
        </button>
        <button
          className="btn btn-sm routine-runs-toggle"
          aria-expanded={expanded}
          onClick={onToggleRuns}
        >
          <IconChevron size={13} className={expanded ? "open" : ""} />
          Runs
        </button>
      </div>
      {expanded && (
        <div className="routine-runs">
          {runs.length === 0 ? (
            <p className="routine-runs-empty">No runs yet.</p>
          ) : (
            <ul className="routine-runs-list">
              {runs.slice(0, 10).map((run) => (
                <li key={run.id} className="routine-run">
                  <span className={`badge badge-${run.status}`}>
                    {runStatusLabel(run.status)}
                  </span>
                  <span className="routine-run-attempts">
                    {run.attempts} {run.attempts === 1 ? "attempt" : "attempts"}
                  </span>
                  {run.test && <span className="chip">test</span>}
                  <span className="routine-run-times">
                    {run.startedAt ? timeAgo(run.startedAt) : "started pending"}
                    {run.finishedAt ? ` · done ${timeAgo(run.finishedAt)}` : ""}
                  </span>
                  {run.error && (
                    <p className="routine-run-error">{run.error}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p className="memory-error">{error}</p>}
    </li>
  );
}

export function RoutinesView() {
  const routines = useStore((s) => s.routines);
  const agents = useStore((s) => s.agents);
  const routineRuns = useStore((s) => s.routineRuns);
  const fetchRoutines = useStore((s) => s.fetchRoutines);
  const fetchRoutineRuns = useStore((s) => s.fetchRoutineRuns);
  const updateRoutine = useStore((s) => s.updateRoutine);
  const deleteRoutine = useStore((s) => s.deleteRoutine);
  const runRoutine = useStore((s) => s.runRoutine);
  const testRoutine = useStore((s) => s.testRoutine);

  const [query, setQuery] = useState("");
  const [modalRoutine, setModalRoutine] = useState<Routine | "new" | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ id: string; kind: "run" | "test" } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchRoutines().catch(() => {});
    void fetchRoutineRuns().catch(() => {});
  }, [fetchRoutines, fetchRoutineRuns]);

  const agentName = (id: string) =>
    agents.find((a) => a.id === id)?.name ?? id;

  const runsFor = (routineId: string) =>
    routineRuns
      .filter((r) => r.routineId === routineId)
      .sort((a, b) =>
        (b.startedAt ?? b.finishedAt ?? "").localeCompare(
          a.startedAt ?? a.finishedAt ?? ""
        )
      );

  const sorted = [...routines]
    .filter((r) => !query.trim() || r.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const toggleEnabled = async (routine: Routine) => {
    setError(null);
    try {
      await updateRoutine(routine.id, { enabled: !routine.enabled });
    } catch (err) {
      setError(err instanceof Error ? err.message : "toggle failed");
    }
  };

  const act = async (routine: Routine, kind: "run" | "test") => {
    setBusy({ id: routine.id, kind });
    setError(null);
    try {
      if (kind === "run") await runRoutine(routine.id);
      else await testRoutine(routine.id);
      void fetchRoutineRuns(routine.id).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "action failed");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (routine: Routine) => {
    if (!window.confirm(`Delete routine ${routine.name}?`)) return;
    setError(null);
    try {
      await deleteRoutine(routine.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    }
  };

  const toggleRuns = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    void fetchRoutineRuns(id).catch(() => {});
  };

  return (
    <div className="view">
      <header className="view-header">
        <h2 className="view-title">Routines</h2>
        <button
          className="btn btn-accent btn-sm"
          onClick={() => setModalRoutine("new")}
        >
          <IconPlus size={16} />
          New routine
        </button>
      </header>
      <div className="routine-toolbar">
        <input
          className="memory-search"
          type="search"
          placeholder="Search routines…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {sorted.length === 0 ? (
        <div className="empty">
          <IconClock size={36} />
          <p>
            {routines.length === 0
              ? "No routines yet. Create one to schedule tasks, expose webhooks or run agents on demand."
              : "No routines match your search."}
          </p>
        </div>
      ) : (
        <ul className="routine-list">
          {sorted.map((routine) => (
            <RoutineCard
              key={routine.id}
              routine={routine}
              runs={runsFor(routine.id)}
              agentName={agentName(routine.agentId)}
              expanded={expandedId === routine.id}
              busy={busy?.id === routine.id ? busy : null}
              error={busy?.id === routine.id ? error : null}
              onToggleEnabled={() => void toggleEnabled(routine)}
              onAct={(kind) => void act(routine, kind)}
              onEdit={() => setModalRoutine(routine)}
              onDelete={() => void remove(routine)}
              onToggleRuns={() => toggleRuns(routine.id)}
            />
          ))}
        </ul>
      )}
      {modalRoutine !== null && (
        <RoutineForm
          routine={modalRoutine === "new" ? null : modalRoutine}
          onClose={() => setModalRoutine(null)}
        />
      )}
    </div>
  );
}

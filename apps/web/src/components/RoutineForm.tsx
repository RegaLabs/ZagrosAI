import { useState } from "react";
import { useStore } from "../store.js";
import type {
  CreateRoutineInput,
  Routine,
  RoutineMissedRuns,
  RoutineTrigger,
} from "../types.js";
import { IconX } from "./Icons.js";

const CAPABILITIES = ["shell", "filesystem", "browser", "docker", "gpu"];

const MISSED_RUNS_OPTIONS: { value: RoutineMissedRuns; label: string }[] = [
  { value: "skip", label: "Skip missed" },
  { value: "run_latest", label: "Run latest only" },
  { value: "backfill", label: "Backfill all missed" },
];

interface RoutineFormProps {
  routine: Routine | null;
  onClose: () => void;
}

export function RoutineForm({ routine, onClose }: RoutineFormProps) {
  const agents = useStore((s) => s.agents);
  const createRoutine = useStore((s) => s.createRoutine);
  const updateRoutine = useStore((s) => s.updateRoutine);

  const [name, setName] = useState(routine?.name ?? "");
  const [description, setDescription] = useState(routine?.description ?? "");
  const [triggerType, setTriggerType] = useState<RoutineTrigger["type"]>(
    routine?.trigger.type ?? "schedule"
  );
  const [cron, setCron] = useState(
    routine?.trigger.type === "schedule" ? routine.trigger.cron : "*/5 * * * *"
  );
  const [missedRuns, setMissedRuns] = useState<RoutineMissedRuns>(
    routine?.trigger.type === "schedule"
      ? (routine.trigger.missedRuns ?? "skip")
      : "skip"
  );
  const [path, setPath] = useState(
    routine?.trigger.type === "webhook" ? routine.trigger.path : ""
  );
  const [agentId, setAgentId] = useState(
    routine?.agentId ?? agents[0]?.id ?? ""
  );
  const [prompt, setPrompt] = useState(routine?.prompt ?? "");
  const [skill, setSkill] = useState(routine?.skill ?? "");
  const [attempts, setAttempts] = useState(routine?.retry.attempts ?? 0);
  const [backoffSeconds, setBackoffSeconds] = useState(
    routine ? Math.round(routine.retry.backoffMs / 1000) : 30
  );
  const [deadLetter, setDeadLetter] = useState(routine?.retry.deadLetter ?? false);
  const [capabilities, setCapabilities] = useState<string[]>(
    routine?.workerRequirements.capabilities ?? []
  );
  const [harnesses, setHarnesses] = useState(
    (routine?.workerRequirements.harnesses ?? []).join(", ")
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggleCapability = (capability: string) => {
    setCapabilities((prev) =>
      prev.includes(capability)
        ? prev.filter((c) => c !== capability)
        : [...prev, capability]
    );
  };

  const save = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!prompt.trim()) {
      setError("Prompt is required");
      return;
    }
    if (!agentId) {
      setError("Agent is required");
      return;
    }
    let trigger: RoutineTrigger;
    if (triggerType === "schedule") {
      if (!cron.trim()) {
        setError("Cron expression is required");
        return;
      }
      trigger = { type: "schedule", cron: cron.trim(), missedRuns };
    } else if (triggerType === "webhook") {
      if (!path.trim()) {
        setError("Webhook path is required");
        return;
      }
      trigger = { type: "webhook", path: path.trim() };
    } else {
      trigger = { type: "manual" };
    }
    const body: CreateRoutineInput = {
      name: name.trim(),
      description: description.trim() || undefined,
      trigger,
      agentId,
      prompt: prompt.trim(),
      skill: skill.trim() || undefined,
      retry: {
        attempts: Math.min(5, Math.max(0, Math.round(attempts))),
        backoffMs: Math.max(0, Math.round(backoffSeconds)) * 1000,
        deadLetter,
      },
      workerRequirements: {
        capabilities,
        harnesses: harnesses
          .split(",")
          .map((h) => h.trim())
          .filter((h) => h.length > 0),
      },
    };
    setSaving(true);
    setError(null);
    try {
      if (routine) await updateRoutine(routine.id, body);
      else await createRoutine(body);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal glass" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3 className="modal-title">
            {routine ? "Edit routine" : "New routine"}
          </h3>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <IconX size={18} />
          </button>
        </header>
        <div className="field">
          <label htmlFor="routine-name">Name</label>
          <input
            id="routine-name"
            value={name}
            placeholder="Nightly issue digest"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="routine-description">Description</label>
          <textarea
            id="routine-description"
            rows={2}
            value={description}
            placeholder="What this routine does"
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="routine-trigger">Trigger</label>
          <select
            id="routine-trigger"
            value={triggerType}
            onChange={(e) =>
              setTriggerType(e.target.value as RoutineTrigger["type"])
            }
          >
            <option value="schedule">Schedule</option>
            <option value="manual">Manual</option>
            <option value="webhook">Webhook</option>
          </select>
        </div>
        {triggerType === "schedule" && (
          <>
            <div className="field">
              <label htmlFor="routine-cron">Cron expression</label>
              <input
                id="routine-cron"
                value={cron}
                placeholder="*/5 * * * *"
                onChange={(e) => setCron(e.target.value)}
              />
              <p className="model-hint">
                Use 5-field or 6-field cron (seconds optional), e.g. */5 * * * *
              </p>
            </div>
            <div className="field">
              <label htmlFor="routine-missed">Missed runs</label>
              <select
                id="routine-missed"
                value={missedRuns}
                onChange={(e) =>
                  setMissedRuns(e.target.value as RoutineMissedRuns)
                }
              >
                {MISSED_RUNS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        {triggerType === "webhook" && (
          <div className="webhook-builder-box glass">
            <div className="field">
              <label htmlFor="routine-path">Webhook Endpoint Path</label>
              <input
                id="routine-path"
                value={path}
                placeholder="/nightly-digest"
                onChange={(e) =>
                  setPath(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9/-]+/g, "-")
                  )
                }
              />
            </div>
            <div className="field">
              <label>Target Webhook URL Preview</label>
              <div className="token-row">
                <code className="token-value">
                  {path
                    ? `${window.location.origin}/api/webhooks${path.startsWith("/") ? path : `/${path}`}`
                    : "Enter path above to generate Webhook URL"}
                </code>
                {path && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      const fullUrl = `${window.location.origin}/api/webhooks${path.startsWith("/") ? path : `/${path}`}`;
                      void navigator.clipboard.writeText(fullUrl).catch(() => {});
                    }}
                  >
                    Copy URL
                  </button>
                )}
              </div>
            </div>
            <p className="model-hint">
              Triggers this routine upon receiving HTTP POST requests. Incoming JSON payload will be passed to prompt as <code>{"{payload}"}</code>.
            </p>
          </div>
        )}
        <div className="field">
          <label htmlFor="routine-agent">Agent</label>
          <select
            id="routine-agent"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          >
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          {agents.length === 0 && (
            <p className="model-hint">Create an agent first.</p>
          )}
        </div>
        <div className="field">
          <label htmlFor="routine-prompt">Prompt</label>
          <textarea
            id="routine-prompt"
            rows={4}
            value={prompt}
            placeholder="Check the repo for new issues and summarize. Payload: {payload}"
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="routine-skill">Skill (optional)</label>
          <input
            id="routine-skill"
            value={skill}
            placeholder="my-skill"
            onChange={(e) => setSkill(e.target.value)}
          />
        </div>
        <div className="field-group-title">Retry</div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="routine-attempts">Attempts (0-5)</label>
            <input
              id="routine-attempts"
              type="number"
              min={0}
              max={5}
              value={attempts}
              onChange={(e) => setAttempts(Number(e.target.value))}
            />
          </div>
          <div className="field grow">
            <label htmlFor="routine-backoff">Backoff (seconds)</label>
            <input
              id="routine-backoff"
              type="number"
              min={0}
              value={backoffSeconds}
              onChange={(e) => setBackoffSeconds(Number(e.target.value))}
            />
          </div>
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={deadLetter}
            onChange={(e) => setDeadLetter(e.target.checked)}
          />
          <span>Send failures to dead letter queue</span>
        </label>
        <div className="field-group-title">Worker requirements</div>
        <div className="cap-grid">
          {CAPABILITIES.map((capability) => (
            <label key={capability} className="check-row">
              <input
                type="checkbox"
                checked={capabilities.includes(capability)}
                onChange={() => toggleCapability(capability)}
              />
              <span>{capability}</span>
            </label>
          ))}
        </div>
        <div className="field">
          <label htmlFor="routine-harnesses">
            Harnesses (comma separated)
          </label>
          <input
            id="routine-harnesses"
            value={harnesses}
            placeholder="codex, claude-code"
            onChange={(e) => setHarnesses(e.target.value)}
          />
        </div>
        {error && <p className="form-error">{error}</p>}
        <footer className="modal-footer">
          <span className="modal-footer-spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-accent"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
}

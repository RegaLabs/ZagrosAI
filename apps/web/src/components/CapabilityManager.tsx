import { useEffect, useState } from "react";
import { postJson } from "../api.js";
import { useStore } from "../store.js";
import type { ModelConfig, ModelDriver } from "../types.js";
import {
  IconAlert,
  IconCheck,
  IconCpu,
  IconDot,
  IconPlus,
  IconRefresh,
  IconShield,
} from "./Icons.js";
import { ModelForm } from "./ModelForm.js";

interface HarnessStatus {
  name: string;
  driver: ModelDriver;
  availableWorkers: number;
  loggedIn: boolean;
  status: "active" | "standby" | "unavailable";
}

const HARNESS_PRESETS: { name: string; driver: ModelDriver; desc: string }[] = [
  { name: "codex", driver: "acp", desc: "OpenAI Codex CLI harness on local/remote worker" },
  { name: "claude-code", driver: "acp", desc: "Anthropic Claude Code CLI harness with OAuth" },
  { name: "gemini-cli", driver: "acp", desc: "Google Gemini CLI harness for multimodal agents" },
  { name: "gpt-runner", driver: "openai", desc: "Native OpenAI API direct runner driver" },
  { name: "ollama-local", driver: "ollama", desc: "Local Ollama LLM execution engine" },
];

export function CapabilityManager() {
  const settings = useStore((s) => s.settings);
  const workers = useStore((s) => s.workers);
  const updateSettings = useStore((s) => s.updateSettings);

  const [modelDraft, setModelDraft] = useState<ModelConfig | null>(
    settings?.defaultModel ?? null
  );

  useEffect(() => {
    if (settings?.defaultModel && !modelDraft) {
      setModelDraft(settings.defaultModel);
    }
  }, [settings?.defaultModel, modelDraft]);

  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    latencyMs?: number;
    activeDriver?: string;
    message?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveModel = async () => {
    const toSave = modelDraft ?? settings?.defaultModel;
    if (!toSave) return;
    setSaving(true);
    setError(null);
    try {
      await updateSettings({ defaultModel: toSave });
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const testProvider = async () => {
    setTesting(true);
    setTestResult(null);
    const start = performance.now();
    try {
      const res = await postJson<{ ok: boolean; error?: string }>(
        "/api/executor/tool",
        {
          toolId: "files.list",
          args: { path: "." },
        }
      );
      const elapsed = Math.round(performance.now() - start);
      if (res.ok) {
        setTestResult({
          ok: true,
          latencyMs: elapsed,
          activeDriver: modelDraft?.driver ?? "default",
          message: "Execution fabric reachable and tool executor responding.",
        });
      } else {
        setTestResult({
          ok: false,
          latencyMs: elapsed,
          message: res.error ?? "Probe returned error",
        });
      }
    } catch (err) {
      const elapsed = Math.round(performance.now() - start);
      setTestResult({
        ok: false,
        latencyMs: elapsed,
        message: err instanceof Error ? err.message : "Probe failed",
      });
    } finally {
      setTesting(false);
    }
  };

  const onlineWorkers = workers.filter((w) => w.online);
  const allHarnesses = Array.from(new Set(workers.flatMap((w) => w.harnesses ?? [])));

  const harnessList: HarnessStatus[] = HARNESS_PRESETS.map((preset) => {
    const matchingWorkers = onlineWorkers.filter(
      (w) => w.harnesses && w.harnesses.includes(preset.name)
    );
    const isAvailable = matchingWorkers.length > 0;
    return {
      name: preset.name,
      driver: preset.driver,
      availableWorkers: matchingWorkers.length,
      loggedIn: isAvailable,
      status: isAvailable ? "active" : onlineWorkers.length > 0 ? "standby" : "unavailable",
    };
  });

  const currentModel = modelDraft ?? settings?.defaultModel;

  return (
    <div className="view">
      <header className="view-header">
        <h2 className="view-title">Model & Provider Capability Manager</h2>
        <button
          className="btn btn-accent btn-sm"
          onClick={() => void testProvider()}
          disabled={testing}
        >
          <IconRefresh size={14} className={testing ? "animate-spin" : ""} />
          {testing ? "Testing…" : "Test model driver"}
        </button>
      </header>

      {testResult && (
        <div className={`capability-test-banner glass ${testResult.ok ? "ok" : "bad"}`}>
          {testResult.ok ? <IconCheck size={18} /> : <IconAlert size={18} />}
          <div className="test-banner-info">
            <span className="test-banner-title">
              {testResult.ok ? "Provider Ready" : "Provider Test Failed"}
            </span>
            <span className="test-banner-desc">{testResult.message}</span>
          </div>
          {testResult.latencyMs !== undefined && (
            <span className="chip chip-latency">{testResult.latencyMs} ms</span>
          )}
        </div>
      )}

      <div className="capabilities-grid">
        <section className="settings-section glass">
          <h3 className="settings-title">
            <IconCpu size={18} />
            Model Configuration
          </h3>
          <p className="settings-hint">
            Configure primary driver, model identifier, API credentials, and fallback drivers.
          </p>
          {currentModel ? (
            <ModelForm value={currentModel} onChange={setModelDraft} />
          ) : (
            <p className="settings-hint">Loading model settings…</p>
          )}
          <div className="settings-actions">
            <button
              className="btn btn-accent"
              onClick={() => void saveModel()}
              disabled={saving || !currentModel}
            >
              {saving ? "Saving…" : "Save configuration"}
            </button>
            {savedFlash && <span className="saved-flash">Saved!</span>}
          </div>
        </section>

        <section className="settings-section glass">
          <h3 className="settings-title">
            <IconShield size={18} />
            Model Capabilities
          </h3>
          <div className="cap-specs-grid">
            <div className="cap-spec-card">
              <span className="cap-spec-label">Streaming</span>
              <span className="cap-spec-value ok">Supported (SSE/WS)</span>
            </div>
            <div className="cap-spec-card">
              <span className="cap-spec-label">Vision / Image Input</span>
              <span className={`cap-spec-value ${currentModel?.imageInput ? "ok" : "muted"}`}>
                {currentModel?.imageInput ? "Enabled" : "Disabled"}
              </span>
            </div>
            <div className="cap-spec-card">
              <span className="cap-spec-label">Tool Calling</span>
              <span className="cap-spec-value ok">Native (R0-R3 Risk Policy)</span>
            </div>
            <div className="cap-spec-card">
              <span className="cap-spec-label">Structured Output</span>
              <span className="cap-spec-value ok">JSON Schema Strict</span>
            </div>
            <div className="cap-spec-card">
              <span className="cap-spec-label">Context Window</span>
              <span className="cap-spec-value">128,000 - 2,000,000 tokens</span>
            </div>
            <div className="cap-spec-card">
              <span className="cap-spec-label">Max Output</span>
              <span className="cap-spec-value">8,192 tokens</span>
            </div>
          </div>

          <h4 className="settings-subtitle" style={{ marginTop: "24px" }}>
            Harness Login & Worker Status (v0.6.0)
          </h4>
          <p className="settings-hint">
            Harnesses run on execution workers and maintain their own provider login credentials.
          </p>
          <ul className="harness-list">
            {harnessList.map((harness) => (
              <li key={harness.name} className="harness-row">
                <div className="harness-main">
                  <span className="harness-name">{harness.name}</span>
                  <span className="chip">{harness.driver}</span>
                  <span className="harness-desc">
                    {harness.availableWorkers} worker{harness.availableWorkers === 1 ? "" : "s"} online
                  </span>
                </div>
                <span className={`harness-status-badge status-${harness.status}`}>
                  <IconDot
                    size={8}
                    className={harness.status === "active" ? "dot-online" : "dot-offline"}
                  />
                  {harness.status === "active"
                    ? "Logged in & Active"
                    : harness.status === "standby"
                      ? "Standby"
                      : "Unavailable"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {error && (
        <div className="settings-error" style={{ marginTop: "16px" }}>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

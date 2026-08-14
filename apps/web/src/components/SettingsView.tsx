import { useEffect, useState } from "react";
import { postJson } from "../api.js";
import type { Lang } from "../i18n.js";
import { getPushState, subscribeToPush, unsubscribeFromPush } from "../push.js";
import type { PushState } from "../push.js";
import { useStore } from "../store.js";
import type { DepsScanResponse, McpServerConfig, ModelConfig } from "../types.js";
import {
  IconBell,
  IconComputer,
  IconCopy,
  IconDot,
  IconDownload,
  IconLink,
  IconPlus,
  IconShield,
  IconTrash,
  IconUpload,
  IconX,
} from "./Icons.js";
import { ModelForm } from "./ModelForm.js";
import { OnboardingModal } from "./OnboardingModal.js";

interface McpDraft {
  name: string;
  command: string;
  args: string;
  cwd: string;
  url: string;
}

const EMPTY_MCP_DRAFT: McpDraft = { name: "", command: "", args: "", cwd: "", url: "" };

function mcpTarget(server: McpServerConfig): string {
  if (server.transport === "http") return server.url ?? "";
  return [server.command, ...server.args].join(" ");
}

export function SettingsView() {
  const settings = useStore((s) => s.settings);
  const securityStatus = useStore((s) => s.securityStatus);
  const runDepsScan = useStore((s) => s.runDepsScan);
  const workers = useStore((s) => s.workers);
  const oauthProviders = useStore((s) => s.oauthProviders);
  const oauthEnabled = useStore((s) => s.oauthEnabled);
  const connectors = useStore((s) => s.connectors);
  const mcpServers = useStore((s) => s.mcpServers);
  const a2aAgents = useStore((s) => s.a2aAgents);
  const artifacts = useStore((s) => s.artifacts);
  const updateSettings = useStore((s) => s.updateSettings);
  const connectProvider = useStore((s) => s.connectProvider);
  const revokeConnector = useStore((s) => s.revokeConnector);
  const authorizeMcpServer = useStore((s) => s.authorizeMcpServer);
  const exportData = useStore((s) => s.exportData);
  const importData = useStore((s) => s.importData);
  const lang = useStore((s) => s.lang);
  const setLang = useStore((s) => s.setLang);

  const [modelDraft, setModelDraft] = useState<ModelConfig | null>(null);
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [mcpDraft, setMcpDraft] = useState<McpDraft>(EMPTY_MCP_DRAFT);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushState, setPushState] = useState<PushState>("idle");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushTest, setPushTest] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<DepsScanResponse | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    void getPushState()
      .then(setPushState)
      .catch(() => setPushState("idle"));
  }, []);

  useEffect(() => {
    if (settings) setModelDraft(settings.defaultModel);
  }, [settings]);

  const saveModel = async () => {
    if (!modelDraft) return;
    setSaving(true);
    setError(null);
    try {
      await updateSettings({ defaultModel: modelDraft });
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  };

  const addMcp = async () => {
    if (!settings) return;
    const name = mcpDraft.name.trim();
    if (!name) {
      setError("Name is required");
      return;
    }
    if (transport === "http" && !mcpDraft.url.trim()) {
      setError("URL is required");
      return;
    }
    setError(null);
    const server: McpServerConfig =
      transport === "stdio"
        ? {
            id: crypto.randomUUID(),
            name,
            transport: "stdio",
            command: mcpDraft.command.trim(),
            args: mcpDraft.args
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            cwd: mcpDraft.cwd.trim() || undefined,
            env: {},
          }
        : {
            id: crypto.randomUUID(),
            name,
            transport: "http",
            url: mcpDraft.url.trim(),
            args: [],
            env: {},
          };
    try {
      await updateSettings({ mcpServers: [...settings.mcpServers, server] });
      setMcpDraft(EMPTY_MCP_DRAFT);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    }
  };

  const removeMcp = async (id: string) => {
    if (!settings) return;
    if (!window.confirm("Remove this MCP server configuration?")) return;
    setError(null);
    try {
      await updateSettings({
        mcpServers: settings.mcpServers.filter((s) => s.id !== id),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove MCP server");
    }
  };

  const handleRevokeConnector = async (id: string, label: string) => {
    if (!window.confirm(`Revoke ${label} connection?`)) return;
    setError(null);
    try {
      await revokeConnector(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke connector");
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const backup = await exportData();
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `zagros-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError(null);
    setImportResult(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const data = (parsed && typeof parsed === "object" && "data" in parsed) ? parsed.data : parsed;
      if (!data || typeof data !== "object") {
        throw new Error("Invalid backup file: missing data tables");
      }
      const count = await importData(data as Record<string, unknown[]>);
      setImportResult(`Successfully imported ${count} items.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  const copyToken = async () => {
    const token = settings?.runnerToken;
    if (!token || token.includes("•")) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Clipboard unavailable");
    }
  };

  const copyUrl = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedUrl(value);
      window.setTimeout(() => setCopiedUrl(null), 1500);
    } catch {
      setError("Clipboard unavailable");
    }
  };

  const refreshPushState = async () => {
    setPushState(await getPushState());
  };

  const enablePush = async () => {
    setPushBusy(true);
    setPushError(null);
    setPushTest(null);
    try {
      const result = await subscribeToPush();
      if (result.ok) {
        await refreshPushState();
      } else {
        setPushError(result.reason ?? "subscribe failed");
        await refreshPushState();
      }
    } catch (err) {
      setPushError(err instanceof Error ? err.message : "subscribe failed");
    } finally {
      setPushBusy(false);
    }
  };

  const disablePush = async () => {
    setPushBusy(true);
    setPushError(null);
    setPushTest(null);
    try {
      await unsubscribeFromPush();
      await refreshPushState();
    } catch (err) {
      setPushError(err instanceof Error ? err.message : "unsubscribe failed");
    } finally {
      setPushBusy(false);
    }
  };

  const sendTest = async () => {
    setPushBusy(true);
    setPushError(null);
    setPushTest(null);
    try {
      const result = await postJson<{ sent: number; failed: number }>(
        "/api/push/test"
      );
      setPushTest(`sent ${result.sent}, failed ${result.failed}`);
    } catch (err) {
      setPushError(err instanceof Error ? err.message : "test failed");
    } finally {
      setPushBusy(false);
    }
  };

  const handleScan = async () => {
    setScanning(true);
    setScanError(null);
    setScanResult(null);
    try {
      setScanResult(await runDepsScan("."));
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "scan failed");
    } finally {
      setScanning(false);
    }
  };

  const pushLabel =
    pushState === "unsupported"
      ? "Unsupported"
      : pushState === "not-configured"
        ? "Not configured (set VITE_VAPID_PUBLIC_KEY)"
        : pushState === "permission-denied"
          ? "Permission denied"
          : pushState === "subscribed"
            ? "Subscribed"
            : "Idle";

  const onlineWorkers = workers.filter((w) => w.online);

  const [showTour, setShowTour] = useState(false);

  return (
    <div className="view">
      <header className="view-header">
        <h2 className="view-title">Settings</h2>
      </header>

      <section className="settings-section glass">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h3 className="settings-title" style={{ margin: 0 }}>Product Tour & Setup Walkthrough</h3>
            <p style={{ margin: "4px 0 0", fontSize: "12.5px", color: "var(--text-muted)" }}>
              Replay the interactive onboarding walkthrough to explore models, execution runners, and agent templates.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary glass-btn"
            onClick={() => setShowTour(true)}
            style={{ flex: "none" }}
          >
            Launch Tour
          </button>
        </div>
      </section>

      {showTour && (
        <OnboardingModal isOpen={showTour} onClose={() => setShowTour(false)} />
      )}

      <section className="settings-section glass">
        <h3 className="settings-title">Language</h3>
        <div className="field">
          <label htmlFor="settings-lang">Language</label>
          <select
            id="settings-lang"
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
          >
            <option value="en">English</option>
            <option value="ku">Kurdî</option>
          </select>
        </div>
      </section>

      <section className="settings-section glass">
        <h3 className="settings-title">Default model</h3>
        {modelDraft && (
          <ModelForm value={modelDraft} onChange={setModelDraft} />
        )}
        <div className="settings-actions">
          <button
            className="btn btn-accent"
            onClick={() => void saveModel()}
            disabled={saving || !modelDraft}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {savedFlash && <span className="saved-flash">Saved</span>}
        </div>
      </section>

      <section className="settings-section glass">
        <h3 className="settings-title">MCP servers</h3>
        {settings && settings.mcpServers.length > 0 ? (
          <ul className="mcp-list">
            {settings.mcpServers.map((server) => {
              const oauth = mcpServers.find((ms) => ms.id === server.id)?.oauth;
              return (
                <li key={server.id}>
                  <div className="mcp-row">
                    <div className="mcp-info">
                      <span className="mcp-name">{server.name}</span>
                      <span className="chip">{server.transport}</span>
                      <span className="mcp-target">{mcpTarget(server)}</span>
                    </div>
                    <button
                      className="icon-btn"
                      aria-label={`Remove MCP server ${server.name}`}
                      onClick={() => void removeMcp(server.id)}
                    >
                      <IconTrash size={15} />
                    </button>
                  </div>
                  {oauth && (
                    <div className="mcp-oauth">
                      {oauth.status === "connected" && (
                        <span className="oauth-status ok">
                          <IconDot size={8} className="dot-online" />
                          connected
                        </span>
                      )}
                      {oauth.status === "awaiting" && (
                        <>
                          <span className="oauth-status">
                            <IconDot size={8} className="dot-offline" />
                            awaiting authorization
                          </span>
                          <button
                            className="btn btn-sm"
                            onClick={() => authorizeMcpServer(server.id)}
                          >
                            Authorize
                          </button>
                        </>
                      )}
                      {oauth.status === "error" && (
                        <span className="oauth-status bad">
                          <IconDot size={8} className="dot-offline" />
                          error{oauth.error ? `: ${oauth.error}` : ""}
                        </span>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="settings-hint">No MCP servers configured.</p>
        )}
        <div className="mcp-add">
          <div className="field-row">
            <div className="field">
              <label htmlFor="mcp-transport">Transport</label>
              <select
                id="mcp-transport"
                value={transport}
                onChange={(e) =>
                  setTransport(e.target.value as "stdio" | "http")
                }
              >
                <option value="stdio">stdio</option>
                <option value="http">http</option>
              </select>
            </div>
            <div className="field grow">
              <label htmlFor="mcp-name">Name</label>
              <input
                id="mcp-name"
                value={mcpDraft.name}
                placeholder="filesystem"
                onChange={(e) => setMcpDraft({ ...mcpDraft, name: e.target.value })}
              />
            </div>
          </div>
          {transport === "stdio" ? (
            <div className="field-row">
              <div className="field grow">
                <label htmlFor="mcp-command">Command</label>
                <input
                  id="mcp-command"
                  value={mcpDraft.command}
                  placeholder="npx"
                  onChange={(e) =>
                    setMcpDraft({ ...mcpDraft, command: e.target.value })
                  }
                />
              </div>
              <div className="field grow">
                <label htmlFor="mcp-args">Args (comma separated)</label>
                <input
                  id="mcp-args"
                  value={mcpDraft.args}
                  placeholder="-y, @modelcontextprotocol/server-filesystem, /tmp"
                  onChange={(e) => setMcpDraft({ ...mcpDraft, args: e.target.value })}
                />
              </div>
            </div>
          ) : (
            <div className="field">
              <label htmlFor="mcp-url">URL</label>
              <input
                id="mcp-url"
                value={mcpDraft.url}
                placeholder="https://mcp.example.com/sse"
                onChange={(e) => setMcpDraft({ ...mcpDraft, url: e.target.value })}
              />
            </div>
          )}
          <div className="settings-actions">
            <button className="btn" onClick={() => void addMcp()}>
              <IconPlus size={16} />
              Add server
            </button>
          </div>
        </div>
      </section>

      <section className="settings-section glass">
        <h3 className="settings-title">
          <IconBell size={16} />
          Notifications
        </h3>
        <p className="settings-hint">State: {pushLabel}</p>
        <div className="settings-actions">
          {pushState === "subscribed" ? (
            <>
              <button
                className="btn"
                onClick={() => void disablePush()}
                disabled={pushBusy}
              >
                <IconBell size={16} />
                Disable
              </button>
              <button
                className="btn btn-accent"
                onClick={() => void sendTest()}
                disabled={pushBusy}
              >
                Send test notification
              </button>
            </>
          ) : (
            <button
              className="btn btn-accent"
              onClick={() => void enablePush()}
              disabled={
                pushBusy ||
                pushState === "unsupported" ||
                pushState === "not-configured" ||
                pushState === "permission-denied"
              }
            >
              <IconBell size={16} />
              Enable push notifications
            </button>
          )}
        </div>
        {pushError && (
          <div className="settings-error">
            <span>{pushError}</span>
          </div>
        )}
        {pushTest && <p className="settings-hint">{pushTest}</p>}
      </section>

      <section className="settings-section glass">
        <h3 className="settings-title">Runner token</h3>
        <div className="token-row">
          <code className="token-value">
            {settings?.runnerToken ?? "not configured"}
          </code>
          <button
            className="icon-btn"
            aria-label="Copy runner token"
            onClick={() => void copyToken()}
          >
            <IconCopy size={16} />
          </button>
          {copied && <span className="saved-flash">Copied</span>}
        </div>
      </section>

      <section className="settings-section glass">
        <h3 className="settings-title">
          <IconLink size={16} />
          Connections
        </h3>
        {!oauthEnabled && (
          <p className="settings-hint">
            OAuth connectors are disabled — set ZAGROS_MASTER_KEY (or
            data/master.key locally) and restart.
          </p>
        )}
        <p className="settings-subtitle">Providers</p>
        {oauthProviders.length === 0 ? (
          <p className="settings-hint">No OAuth providers configured.</p>
        ) : (
          <ul className="conn-list">
            {oauthProviders.map((provider) => (
              <li key={provider.id} className="conn-row">
                <div className="conn-info">
                  <span className="conn-name">{provider.label}</span>
                  {provider.scopes.length > 0 && (
                    <span className="conn-scopes">
                      {provider.scopes.join(", ")}
                    </span>
                  )}
                </div>
                <button
                  className="btn btn-sm"
                  onClick={() => connectProvider(provider.id)}
                >
                  Connect
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="settings-subtitle">Connected accounts</p>
        {connectors.length === 0 ? (
          <p className="settings-hint">No connectors yet.</p>
        ) : (
          <ul className="conn-list">
            {connectors.map((connector) => (
              <li key={connector.id} className="conn-row">
                <div className="conn-info">
                  <span className="conn-name">{connector.providerLabel}</span>
                  <span className="conn-scopes">
                    {connector.account}
                    {connector.scopes.length > 0
                      ? ` · ${connector.scopes.join(", ")}`
                      : ""}
                  </span>
                </div>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => void handleRevokeConnector(connector.id, connector.providerLabel)}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="settings-section glass">
        <h3 className="settings-title">
          <IconLink size={16} />
          A2A
        </h3>
        <p className="settings-hint">
          External A2A agents can reach your agents at these endpoints.
        </p>
        {a2aAgents.length === 0 ? (
          <p className="settings-hint">No A2A endpoints exposed yet.</p>
        ) : (
          <ul className="conn-list">
            {a2aAgents.map((agent) => (
              <li key={agent.agentId} className="conn-row a2a-row">
                <div className="conn-info">
                  <span className="conn-name">{agent.name}</span>
                  <span className="conn-scopes">{agent.agentId}</span>
                </div>
                <div className="a2a-endpoints">
                  <div className="token-row">
                    <code className="token-value">{agent.cardUrl}</code>
                    <button
                      className="icon-btn"
                      aria-label={`Copy card URL for ${agent.name}`}
                      onClick={() => void copyUrl(agent.cardUrl)}
                    >
                      <IconCopy size={15} />
                    </button>
                    {copiedUrl === agent.cardUrl && (
                      <span className="saved-flash">Copied</span>
                    )}
                  </div>
                  <div className="token-row">
                    <code className="token-value">{agent.jsonrpcUrl}</code>
                    <button
                      className="icon-btn"
                      aria-label={`Copy JSON-RPC URL for ${agent.name}`}
                      onClick={() => void copyUrl(agent.jsonrpcUrl)}
                    >
                      <IconCopy size={15} />
                    </button>
                    {copiedUrl === agent.jsonrpcUrl && (
                      <span className="saved-flash">Copied</span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="settings-subtitle">Shared artifacts</p>
        <p className="settings-hint">
          {artifacts.length} shared artifact{artifacts.length === 1 ? "" : "s"}
        </p>
        {artifacts.length > 0 && (
          <div className="chip-row artifact-chips">
            {artifacts.slice(0, 5).map((artifact) => (
              <span key={artifact.id} className="chip">
                {artifact.key}
              </span>
            ))}
            {artifacts.length > 5 && (
              <span className="chip">+{artifacts.length - 5} more</span>
            )}
          </div>
        )}
      </section>

      <section className="settings-section glass">
        <h3 className="settings-title">
          <IconShield size={16} />
          Security
        </h3>
        {securityStatus ? (
          <div className="status-grid">
            <div className="status-item">
              <span className="status-label">Master key</span>
              <span className="status-value">
                <IconDot
                  size={8}
                  className={
                    securityStatus.masterKeyConfigured ? "dot-online" : "dot-offline"
                  }
                />
                {securityStatus.masterKeyConfigured ? "configured" : "not configured"}
              </span>
            </div>
            <div className="status-item">
              <span className="status-label">Skill verification</span>
              <span className="status-value">
                <IconDot
                  size={8}
                  className={
                    securityStatus.skillVerificationEnabled
                      ? "dot-online"
                      : "dot-offline"
                  }
                />
                {securityStatus.skillVerificationEnabled ? "enabled" : "disabled"}
              </span>
            </div>
            <div className="status-item">
              <span className="status-label">Audit hashing</span>
              <span className="status-value">
                <IconDot
                  size={8}
                  className={
                    securityStatus.auditHashing ? "dot-online" : "dot-offline"
                  }
                />
                {securityStatus.auditHashing ? "enabled" : "disabled"}
              </span>
            </div>
            <div className="status-item">
              <span className="status-label">Rate limit</span>
              <span className="status-value">
                {securityStatus.rateLimitPerMinute}/min
              </span>
            </div>
            <div className="status-item">
              <span className="status-label">Max concurrent tasks</span>
              <span className="status-value">
                {securityStatus.maxConcurrentTasks}
              </span>
            </div>
            <div className="status-item">
              <span className="status-label">Online runners</span>
              <span className="status-value">
                {securityStatus.runnerCount}
              </span>
            </div>
            <div className="status-item">
              <span className="status-label">Active harnesses</span>
              <div className="status-chip-row">
                {securityStatus.harnesses.length === 0 ? (
                  <span className="chip">none</span>
                ) : (
                  securityStatus.harnesses.map((harness) => (
                    <span key={harness} className="chip">
                      {harness}
                    </span>
                  ))
                )}
              </div>
            </div>
            <div className="status-item">
              <span className="status-label">Recent audit events</span>
              <span className="status-value">
                {securityStatus.recentAuditEvents}
              </span>
            </div>
            <div className="status-item">
              <span className="status-label">Version</span>
              <span className="status-value">{securityStatus.version}</span>
            </div>
          </div>
        ) : (
          <p className="settings-hint">Loading security status…</p>
        )}
        <div className="scan-row">
          <div className="scan-info">
            <span className="scan-title">Dependency scan</span>
            <span className="scan-desc">
              Runs on a connected Runner's shell (pnpm/npm audit). Requires a
              package manifest in the runner workspace.
            </span>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => void handleScan()}
            disabled={scanning}
          >
            {scanning ? "Scanning…" : "Scan"}
          </button>
        </div>
        {scanError && <p className="scan-error">{scanError}</p>}
        {scanResult && !scanResult.ok && (
          <p className="scan-error">{scanResult.error}</p>
        )}
        {scanResult && scanResult.ok && (
          <div
            className={
              scanResult.summary.critical > 0
                ? "scan-summary bad"
                : "scan-summary good"
            }
          >
            <span className="scan-total">
              {scanResult.summary.total} packages
            </span>
            <span className="chip chip-critical">
              critical {scanResult.summary.critical}
            </span>
            <span className="chip">high {scanResult.summary.high}</span>
            <span className="chip">moderate {scanResult.summary.moderate}</span>
            <span className="chip">low {scanResult.summary.low}</span>
          </div>
        )}
      </section>

      <section className="settings-section glass">
        <h3 className="settings-title">
          Computers
          <span className="settings-count">{onlineWorkers.length}/{workers.length} online</span>
        </h3>
        {workers.length === 0 ? (
          <div className="empty compact">
            <IconComputer size={36} />
            <p>No workers connected. Install the runner to add one.</p>
          </div>
        ) : (
          <ul className="worker-list">
            {workers.map((worker) => (
              <li key={worker.id} className="worker-row">
                <IconDot
                  size={10}
                  className={worker.online ? "dot-online" : "dot-offline"}
                />
                <div className="worker-info">
                  <span className="worker-name">{worker.name}</span>
                  <span className="worker-os">
                    {worker.os} · {worker.arch}
                  </span>
                  <div className="worker-chips">
                    {(["shell", "filesystem", "browser", "docker", "gpu"] as const).map(
                      (cap) =>
                        worker.capabilities[cap] ? (
                          <span key={cap} className="chip">
                            {cap}
                          </span>
                        ) : null
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="settings-section glass">
        <h3 className="settings-title">
          <IconDownload size={18} />
          Data Backup & Export / Import
        </h3>
        <p className="settings-desc">
          Export your entire Zagros database (agents, conversations, memories, routines, tools, audit) as a portable JSON snapshot, or restore from a previous backup.
        </p>
        <div className="settings-actions">
          <button
            type="button"
            className="btn btn-secondary glass-btn"
            onClick={() => void handleExport()}
            disabled={exporting}
          >
            <IconDownload size={14} />
            {exporting ? "Exporting database…" : "Export Database (JSON)"}
          </button>
          <label
            className="btn btn-secondary glass-btn"
            style={{ cursor: importing ? "not-allowed" : "pointer" }}
          >
            <IconUpload size={14} />
            {importing ? "Restoring backup…" : "Import Backup (JSON)"}
            <input
              type="file"
              accept=".json,application/json"
              hidden
              disabled={importing}
              onChange={(e) => void handleImportFile(e)}
            />
          </label>
        </div>
        {importResult && (
          <p className="settings-hint" style={{ color: "var(--color-success, #22c55e)", marginTop: "8px" }}>
            {importResult}
          </p>
        )}
      </section>

      <section className="settings-section glass">
        <h3 className="settings-title">System Architecture</h3>
        <p className="settings-desc">
          Zagros separates agent orchestration, model intelligence, MCP tools, and execution runners into a resilient, durable execution fabric.
        </p>
        <div className="system-design-container" style={{ marginTop: "12px", borderRadius: "12px", overflow: "hidden", border: "1px solid var(--border-glass)" }}>
          <img src="/system-design.png" alt="Zagros System Architecture Promise" style={{ width: "100%", height: "auto", display: "block" }} />
        </div>
      </section>

      {error && (
        <div className="settings-error">
          <span>{error}</span>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => setError(null)}>
            <IconX size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

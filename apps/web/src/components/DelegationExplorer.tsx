import { useEffect, useState } from "react";
import { timeAgo } from "../format.js";
import { useStore } from "../store.js";
import type { A2aAgentInfo, Artifact, Task, TaskStep } from "../types.js";
import {
  IconAlert,
  IconArtifact,
  IconBot,
  IconCheck,
  IconChevron,
  IconClock,
  IconCopy,
  IconDot,
  IconLink,
  IconNetwork,
  IconRefresh,
  IconTrash,
  IconX,
} from "./Icons.js";

function stepStatusBadge(status: TaskStep["status"]) {
  switch (status) {
    case "running":
      return <span className="badge badge-running">running</span>;
    case "completed":
      return <span className="badge badge-completed">completed</span>;
    case "failed":
      return <span className="badge badge-failed">failed</span>;
    case "skipped":
      return <span className="badge badge-cancelled">skipped</span>;
    default:
      return <span className="badge badge-queued">pending</span>;
  }
}

export function DelegationExplorer() {
  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);
  const a2aAgents = useStore((s) => s.a2aAgents);
  const artifacts = useStore((s) => s.artifacts);
  const fetchA2aAgents = useStore((s) => s.fetchA2aAgents);
  const fetchArtifacts = useStore((s) => s.fetchArtifacts);

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedAgentCard, setSelectedAgentCard] = useState<A2aAgentInfo | null>(null);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [artifactQuery, setArtifactQuery] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"tree" | "a2a" | "artifacts">("tree");

  useEffect(() => {
    void fetchA2aAgents().catch(() => {});
    void fetchArtifacts().catch(() => {});
  }, [fetchA2aAgents, fetchArtifacts]);

  const activeTasks = tasks.filter((t) => t.steps && t.steps.length > 0);
  const currentTask = selectedTask ?? activeTasks[0] ?? tasks[0];

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      void 0;
    }
  };

  const filteredArtifacts = artifacts.filter(
    (art) =>
      !artifactQuery.trim() ||
      art.key.toLowerCase().includes(artifactQuery.trim().toLowerCase()) ||
      (art.agentId && art.agentId.toLowerCase().includes(artifactQuery.trim().toLowerCase()))
  );

  const refreshTasks = useStore((s) => s.refreshTasks);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshTasks(), fetchA2aAgents(), fetchArtifacts()]);
    } catch {
      void 0;
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="view">
      <header className="view-header">
        <h2 className="view-title">Multi-Agent Delegation & A2A Explorer</h2>
        <div className="delegation-tabs">
          <button
            className={`btn btn-sm ${activeTab === "tree" ? "btn-accent" : ""}`}
            onClick={() => setActiveTab("tree")}
          >
            <IconNetwork size={14} />
            Decomposition Tree
          </button>
          <button
            className={`btn btn-sm ${activeTab === "a2a" ? "btn-accent" : ""}`}
            onClick={() => setActiveTab("a2a")}
          >
            <IconBot size={14} />
            A2A Cards ({a2aAgents.length})
          </button>
          <button
            className={`btn btn-sm ${activeTab === "artifacts" ? "btn-accent" : ""}`}
            onClick={() => setActiveTab("artifacts")}
          >
            <IconArtifact size={14} />
            Shared Artifacts ({artifacts.length})
          </button>
          <button
            className="btn btn-sm"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            aria-label="Refresh delegation data"
          >
            <IconRefresh size={14} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {activeTab === "tree" && (
        <div className="delegation-layout">
          <aside className="task-selector-pane glass">
            <h3 className="pane-title">Active & Delegated Tasks</h3>
            {tasks.length === 0 ? (
              <p className="settings-hint">No tasks available for decomposition tree.</p>
            ) : (
              <ul className="task-picker-list">
                {tasks.map((task) => {
                  const agent = agents.find((a) => a.id === task.agentId);
                  const isSelected = currentTask?.id === task.id;
                  return (
                    <li key={task.id}>
                      <button
                        className={`task-picker-item ${isSelected ? "active" : ""}`}
                        onClick={() => setSelectedTask(task)}
                      >
                        <div className="task-picker-top">
                          <span className="task-picker-id">Task {task.id.slice(-6)}</span>
                          <span className={`badge badge-${task.status}`}>
                            {task.status.replace(/_/g, " ")}
                          </span>
                        </div>
                        <span className="task-picker-meta">
                          {agent?.name ?? task.agentId} · {task.steps.length} steps ·{" "}
                          {timeAgo(task.createdAt)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          <main className="tree-content-pane glass">
            {currentTask ? (
              <>
                <div className="tree-header">
                  <div>
                    <h3 className="tree-title">Subtask Decomposition Tree</h3>
                    <span className="tree-subtitle">
                      Task ID: <code>{currentTask.id}</code> · Agent:{" "}
                      <strong>
                        {agents.find((a) => a.id === currentTask.agentId)?.name ??
                          currentTask.agentId}
                      </strong>
                    </span>
                  </div>
                  <span className={`badge badge-${currentTask.status}`}>
                    {currentTask.status.replace(/_/g, " ")}
                  </span>
                </div>

                <div className="decomposition-tree">
                  <div className="tree-node root-node">
                    <div className="node-card root-card">
                      <IconBot size={18} />
                      <div className="node-info">
                        <span className="node-title">
                          Primary Coordinator (
                          {agents.find((a) => a.id === currentTask.agentId)?.name ?? "Agent"})
                        </span>
                        <span className="node-sub">
                          {currentTask.modelCalls} model calls · {currentTask.toolCalls} tool calls
                        </span>
                      </div>
                    </div>
                  </div>

                  {currentTask.steps.length === 0 ? (
                    <div className="tree-empty">
                      <p>No subtask steps generated yet for this task.</p>
                    </div>
                  ) : (
                    <div className="tree-children">
                      {currentTask.steps.map((step, idx) => (
                        <div key={step.id} className="tree-branch">
                          <div className="tree-line" />
                          <div className="tree-node step-node">
                            <div className="node-card step-card">
                              <div className="step-card-header">
                                <span className="step-number">Step {idx + 1}</span>
                                <span className="step-kind-tag">{step.kind}</span>
                                {stepStatusBadge(step.status)}
                              </div>
                              <span className="step-objective">
                                {step.objective ?? step.toolId ?? `Execution Step ${idx + 1}`}
                              </span>
                              {step.workerId && (
                                <span className="step-worker">Worker: {step.workerId}</span>
                              )}
                              {step.error && <p className="step-error-msg">{step.error}</p>}
                              {step.toolArgs !== undefined && (
                                <details className="step-args-details">
                                  <summary>Arguments</summary>
                                  <pre>{JSON.stringify(step.toolArgs, null, 2)}</pre>
                                </details>
                              )}
                              {step.result !== undefined && (
                                <details className="step-result-details">
                                  <summary>Result Output</summary>
                                  <pre>{JSON.stringify(step.result, null, 2).slice(0, 800)}</pre>
                                </details>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="empty">
                <IconNetwork size={36} />
                <p>Select a task to explore its subtask decomposition tree.</p>
              </div>
            )}
          </main>
        </div>
      )}

      {activeTab === "a2a" && (
        <section className="settings-section glass">
          <h3 className="settings-title">
            <IconBot size={18} />
            Agent-to-Agent (A2A) Cards Viewer (v0.8.0)
          </h3>
          <p className="settings-hint">
            Exposed A2A Agent Cards allow autonomous agents to communicate via standardized JSON-RPC 2.0.
          </p>

          {a2aAgents.length === 0 ? (
            <div className="empty compact">
              <IconBot size={36} />
              <p>No A2A Agent Cards exposed yet. Create an agent to generate an A2A Card.</p>
            </div>
          ) : (
            <div className="a2a-grid">
              {a2aAgents.map((agent) => (
                <div key={agent.agentId} className="a2a-card glass">
                  <div className="a2a-card-top">
                    <h4 className="a2a-agent-name">{agent.name}</h4>
                    <span className="chip">A2A v1.0</span>
                  </div>
                  <span className="a2a-agent-id">ID: {agent.agentId}</span>
                  <div className="a2a-urls">
                    <div className="token-row">
                      <span className="token-label">Card URL</span>
                      <code className="token-value">{agent.cardUrl}</code>
                      <button
                        className="icon-btn"
                        aria-label="Copy Card URL"
                        onClick={() => void copyText(`card-${agent.agentId}`, agent.cardUrl)}
                      >
                        <IconCopy size={14} />
                      </button>
                      {copiedKey === `card-${agent.agentId}` && (
                        <span className="saved-flash">Copied</span>
                      )}
                    </div>
                    <div className="token-row">
                      <span className="token-label">JSON-RPC</span>
                      <code className="token-value">{agent.jsonrpcUrl}</code>
                      <button
                        className="icon-btn"
                        aria-label="Copy JSON-RPC URL"
                        onClick={() => void copyText(`rpc-${agent.agentId}`, agent.jsonrpcUrl)}
                      >
                        <IconCopy size={14} />
                      </button>
                      {copiedKey === `rpc-${agent.agentId}` && (
                        <span className="saved-flash">Copied</span>
                      )}
                    </div>
                  </div>
                  <div className="a2a-card-actions">
                    <button
                      className="btn btn-sm"
                      onClick={() => setSelectedAgentCard(agent)}
                    >
                      <IconLink size={13} />
                      Inspect Agent Card
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === "artifacts" && (
        <section className="settings-section glass">
          <header className="artifacts-header">
            <div>
              <h3 className="settings-title">
                <IconArtifact size={18} />
                Shared Multi-Agent Artifacts Drawer
              </h3>
              <p className="settings-hint">
                Artifacts generated and shared across agent delegations and conversations.
              </p>
            </div>
            <input
              type="search"
              className="memory-search"
              placeholder="Search artifacts by key or agent…"
              value={artifactQuery}
              onChange={(e) => setArtifactQuery(e.target.value)}
            />
          </header>

          {filteredArtifacts.length === 0 ? (
            <div className="empty compact">
              <IconArtifact size={36} />
              <p>
                {artifacts.length === 0
                  ? "No shared artifacts created yet."
                  : "No artifacts match your search query."}
              </p>
            </div>
          ) : (
            <div className="artifacts-grid">
              {filteredArtifacts.map((artifact) => (
                <div key={artifact.id} className="artifact-card glass">
                  <div className="artifact-card-top">
                    <span className="artifact-key">{artifact.key}</span>
                    <span className="artifact-time">{timeAgo(artifact.createdAt)}</span>
                  </div>
                  {artifact.agentId && (
                    <span className="artifact-agent">Agent: {artifact.agentId}</span>
                  )}
                  <div className="artifact-value-preview">
                    <pre>{JSON.stringify(artifact.value, null, 2).slice(0, 180)}</pre>
                  </div>
                  <div className="artifact-card-footer">
                    <button
                      className="btn btn-sm"
                      onClick={() => setSelectedArtifact(artifact)}
                    >
                      View full artifact
                    </button>
                    <button
                      className="icon-btn"
                      aria-label="Copy artifact value"
                      onClick={() =>
                        void copyText(
                          `art-${artifact.id}`,
                          JSON.stringify(artifact.value, null, 2)
                        )
                      }
                    >
                      <IconCopy size={14} />
                    </button>
                    {copiedKey === `art-${artifact.id}` && (
                      <span className="saved-flash">Copied</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {selectedAgentCard && (
        <div className="modal-overlay" onClick={() => setSelectedAgentCard(null)}>
          <div className="modal glass" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <h3 className="modal-title">A2A Agent Card Inspector</h3>
              <button
                className="icon-btn"
                aria-label="Close"
                onClick={() => setSelectedAgentCard(null)}
              >
                <IconX size={18} />
              </button>
            </header>
            <div className="modal-body">
              <h4 className="agent-card-inspect-name">{selectedAgentCard.name}</h4>
              <p className="settings-hint">
                Standardized A2A 1.0 JSON-RPC Agent Card declaration:
              </p>
              <pre className="json-inspector">
                {JSON.stringify(
                  {
                    name: selectedAgentCard.name,
                    agentId: selectedAgentCard.agentId,
                    version: "1.0.0",
                    protocol: "JSON-RPC 2.0",
                    endpoints: {
                      card: selectedAgentCard.cardUrl,
                      jsonrpc: selectedAgentCard.jsonrpcUrl,
                    },
                    capabilities: ["task_execution", "tool_invocation", "artifact_sharing"],
                  },
                  null,
                  2
                )}
              </pre>
            </div>
            <footer className="modal-footer">
              <button className="btn" onClick={() => setSelectedAgentCard(null)}>
                Close
              </button>
            </footer>
          </div>
        </div>
      )}

      {selectedArtifact && (
        <div className="modal-overlay" onClick={() => setSelectedArtifact(null)}>
          <div className="modal glass" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <h3 className="modal-title">Shared Artifact Viewer</h3>
              <button
                className="icon-btn"
                aria-label="Close"
                onClick={() => setSelectedArtifact(null)}
              >
                <IconX size={18} />
              </button>
            </header>
            <div className="modal-body">
              <div className="artifact-inspect-meta">
                <span className="artifact-inspect-key">Key: {selectedArtifact.key}</span>
                <span className="artifact-inspect-time">
                  Created {timeAgo(selectedArtifact.createdAt)}
                </span>
              </div>
              <pre className="json-inspector">
                {JSON.stringify(selectedArtifact.value, null, 2)}
              </pre>
            </div>
            <footer className="modal-footer">
              <button
                className="btn btn-accent btn-sm"
                onClick={() =>
                  void copyText(
                    `inspect-${selectedArtifact.id}`,
                    JSON.stringify(selectedArtifact.value, null, 2)
                  )
                }
              >
                <IconCopy size={14} />
                Copy artifact JSON
              </button>
              <span className="modal-footer-spacer" />
              <button className="btn" onClick={() => setSelectedArtifact(null)}>
                Close
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

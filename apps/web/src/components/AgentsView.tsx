import { useState } from "react";
import { useStore } from "../store.js";
import type { Agent, AgentPermissions, ModelConfig } from "../types.js";
import { IconBot, IconPencil, IconPlus, IconTrash, IconX } from "./Icons.js";
import { ModelForm } from "./ModelForm.js";

function parseTools(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

interface AgentModalProps {
  agent: Agent | null;
  onClose: () => void;
}

function AgentModal({ agent, onClose }: AgentModalProps) {
  const createAgent = useStore((s) => s.createAgent);
  const updateAgent = useStore((s) => s.updateAgent);
  const deleteAgent = useStore((s) => s.deleteAgent);
  const [name, setName] = useState(agent?.name ?? "");
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? "");
  const [group, setGroup] = useState(agent?.group ?? "");
  const [denyTools, setDenyTools] = useState(
    agent?.permissions?.denyTools.join(", ") ?? ""
  );
  const [approvalTools, setApprovalTools] = useState(
    agent?.permissions?.approvalTools.join(", ") ?? ""
  );
  const [model, setModel] = useState<ModelConfig>(
    agent?.model ?? { driver: "openai", model: "", temperature: 0.7, imageInput: true }
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const denyChips = parseTools(denyTools);
  const approvalChips = parseTools(approvalTools);

  const save = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const permissions: AgentPermissions = {
        denyTools: denyChips,
        approvalTools: approvalChips,
      };
      const groupValue = group.trim() || undefined;
      if (agent) {
        await updateAgent(agent.id, {
          name: name.trim(),
          systemPrompt,
          model,
          permissions,
          group: groupValue,
        });
      } else {
        await createAgent({
          name: name.trim(),
          systemPrompt,
          model,
          permissions,
          group: groupValue,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!agent) return;
    setSaving(true);
    setError(null);
    try {
      await deleteAgent(agent.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal glass" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3 className="modal-title">{agent ? "Edit agent" : "New agent"}</h3>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <IconX size={18} />
          </button>
        </header>
        <div className="field">
          <label htmlFor="agent-name">Name</label>
          <input
            id="agent-name"
            value={name}
            placeholder="Research assistant"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="agent-prompt">System prompt</label>
          <textarea
            id="agent-prompt"
            rows={5}
            value={systemPrompt}
            placeholder="You are a helpful, honest agent."
            onChange={(e) => setSystemPrompt(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="agent-group">Group</label>
          <input
            id="agent-group"
            value={group}
            placeholder="research (optional)"
            onChange={(e) => setGroup(e.target.value)}
          />
        </div>
        <div className="field-group-title">Model</div>
        <ModelForm value={model} onChange={setModel} />
        <div className="field-group-title">Permissions</div>
        <div className="field">
          <label htmlFor="agent-deny-tools">Denied tools</label>
          <textarea
            id="agent-deny-tools"
            rows={2}
            value={denyTools}
            placeholder="shell.exec, http.post"
            onChange={(e) => setDenyTools(e.target.value)}
          />
          {denyChips.length > 0 && (
            <div className="chip-row">
              {denyChips.map((tool) => (
                <span key={tool} className="chip">
                  {tool}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="field">
          <label htmlFor="agent-approval-tools">Approval-required tools</label>
          <textarea
            id="agent-approval-tools"
            rows={2}
            value={approvalTools}
            placeholder="fs.write, http.post"
            onChange={(e) => setApprovalTools(e.target.value)}
          />
          {approvalChips.length > 0 && (
            <div className="chip-row">
              {approvalChips.map((tool) => (
                <span key={tool} className="chip">
                  {tool}
                </span>
              ))}
            </div>
          )}
        </div>
        {error && <p className="form-error">{error}</p>}
        <footer className="modal-footer">
          {agent && (
            <button
              className="btn btn-danger"
              onClick={() => void remove()}
              aria-label="Delete agent"
              disabled={saving}
            >
              <IconTrash size={16} />
              Delete
            </button>
          )}
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

export function AgentsView() {
  const agents = useStore((s) => s.agents);
  const [modalAgent, setModalAgent] = useState<Agent | "new" | null>(null);

  return (
    <div className="view">
      <header className="view-header">
        <h2 className="view-title">Agents</h2>
        <button className="btn btn-accent btn-sm" onClick={() => setModalAgent("new")}>
          <IconPlus size={16} />
          New agent
        </button>
      </header>
      {agents.length === 0 ? (
        <div className="empty">
          <IconBot size={36} />
          <p>No agents yet. Create your first agent.</p>
        </div>
      ) : (
        <div className="agents-grid">
          {agents.map((agent) => (
            <article key={agent.id} className="agent-card glass">
              <div className="agent-card-top">
                <h3 className="agent-name">{agent.name}</h3>
                <button
                  className="icon-btn"
                  aria-label={`Edit agent ${agent.name}`}
                  onClick={() => setModalAgent(agent)}
                >
                  <IconPencil size={15} />
                </button>
              </div>
              <span className="agent-model">
                {agent.model.driver} · {agent.model.model}
              </span>
              <p className="agent-prompt">{agent.systemPrompt}</p>
              {(agent.group ||
                agent.permissions?.denyTools.length ||
                agent.permissions?.approvalTools.length) && (
                <div className="chip-row agent-chips">
                  {agent.group && (
                    <span className="chip chip-muted">{agent.group}</span>
                  )}
                  {agent.permissions?.denyTools.map((tool) => (
                    <span key={`deny-${tool}`} className="chip chip-muted">
                      deny: {tool}
                    </span>
                  ))}
                  {agent.permissions?.approvalTools.map((tool) => (
                    <span key={`approve-${tool}`} className="chip chip-muted">
                      approve: {tool}
                    </span>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {modalAgent !== null && (
        <AgentModal
          agent={modalAgent === "new" ? null : modalAgent}
          onClose={() => setModalAgent(null)}
        />
      )}
    </div>
  );
}

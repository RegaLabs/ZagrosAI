import { useState } from "react";
import { useStore } from "../store.js";
import type { ConversationSummary } from "../types.js";
import { IconBot, IconX } from "./Icons.js";

interface Props {
  onClose: () => void;
  onPick: (conversation: ConversationSummary) => void;
}

export function AgentPicker({ onClose, onPick }: Props) {
  const agents = useStore((s) => s.agents);
  const createConversation = useStore((s) => s.createConversation);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const pick = async (agentId: string) => {
    setBusy(agentId);
    setError(null);
    try {
      const conversation = await createConversation(agentId);
      onPick(conversation);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal glass" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3 className="modal-title">New chat</h3>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <IconX size={18} />
          </button>
        </header>
        <p className="modal-subtitle">Pick an agent to talk to</p>
        {agents.length === 0 ? (
          <div className="empty">
            <IconBot size={36} />
            <p>No agents yet. Create one first.</p>
          </div>
        ) : (
          <ul className="agent-pick-list">
            {agents.map((agent) => (
              <li key={agent.id}>
                <button
                  className="agent-pick glass"
                  onClick={() => void pick(agent.id)}
                  disabled={busy !== null}
                >
                  <span className="agent-pick-name">{agent.name}</span>
                  <span className="agent-pick-model">
                    {agent.model.driver} · {agent.model.model}
                  </span>
                  {busy === agent.id && <span className="spinner" />}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="form-error">{error}</p>}
      </div>
    </div>
  );
}

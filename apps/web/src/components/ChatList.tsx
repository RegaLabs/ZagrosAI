import { useState } from "react";
import type { MouseEvent } from "react";
import { timeAgo } from "../format.js";
import { useStore } from "../store.js";
import { AgentPicker } from "./AgentPicker.js";
import { IconChat, IconPlus, IconTrash } from "./Icons.js";

interface Props {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function ChatList({ selectedId, onSelect }: Props) {
  const conversations = useStore((s) => s.conversations);
  const agents = useStore((s) => s.agents);
  const deleteConversation = useStore((s) => s.deleteConversation);
  const [picking, setPicking] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async (event: MouseEvent, id: string) => {
    event.stopPropagation();
    setDeletingId(id);
    setError(null);
    try {
      await deleteConversation(id);
      if (selectedId === id) onSelect(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete conversation");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="chat-list">
      <header className="chat-list-header">
        <h2 className="list-title">Chats</h2>
        <button
          className="btn btn-accent btn-sm"
          onClick={() => setPicking(true)}
        >
          <IconPlus size={16} />
          New chat
        </button>
      </header>
      {error && <p className="form-error" style={{ margin: "8px 12px" }}>{error}</p>}
      {conversations.length === 0 ? (
        <div className="empty">
          <IconChat size={36} />
          <p>No conversations yet. Start a new chat.</p>
        </div>
      ) : (
        <ul className="convo-list">
          {conversations.map((c) => {
            const agent = agents.find((a) => a.id === c.agentId);
            const agentName = c.agentName ?? agent?.name ?? "unknown";
            return (
              <li key={c.id} className="convo-item-wrap">
                <div
                  className={`convo-item ${selectedId === c.id ? "active" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open conversation ${c.title}`}
                  onClick={() => onSelect(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(c.id);
                    }
                  }}
                >
                  <div className="convo-main">
                    <div className="convo-top">
                      <span className="convo-title">{c.title}</span>
                      <span className="convo-time">
                        {timeAgo(c.lastMessageAt ?? c.updatedAt)}
                      </span>
                    </div>
                    <p className="convo-preview">
                      {c.lastMessage || "No messages yet"}
                    </p>
                    <span className="convo-agent">{agentName}</span>
                  </div>
                </div>
                <button
                  className="icon-btn convo-delete"
                  aria-label="Delete conversation"
                  onClick={(e) => void handleDelete(e, c.id)}
                  disabled={deletingId === c.id}
                >
                  <IconTrash size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {picking && (
        <AgentPicker
          onClose={() => setPicking(false)}
          onPick={(conversation) => onSelect(conversation.id)}
        />
      )}
    </div>
  );
}

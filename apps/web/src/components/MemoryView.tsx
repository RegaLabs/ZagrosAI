import { useEffect, useState } from "react";
import { timeAgo } from "../format.js";
import { useStore } from "../store.js";
import type { MemoryKind, MemoryRecord } from "../types.js";
import { IconMemory, IconPencil, IconPlus, IconTrash } from "./Icons.js";

const KIND_FILTERS: ("all" | MemoryKind)[] = [
  "all",
  "episodic",
  "semantic",
  "procedural",
];

function MemoryCard({ memory }: { memory: MemoryRecord }) {
  const editMemory = useStore((s) => s.editMemory);
  const forgetMemory = useStore((s) => s.forgetMemory);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memory.content);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    try {
      await editMemory(memory.id, { content: draft });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    }
  };

  const forget = async () => {
    if (!window.confirm("Forget this memory?")) return;
    setError(null);
    try {
      await forgetMemory(memory.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "forget failed");
    }
  };

  const confidencePct = Math.round(memory.confidence * 100);

  return (
    <li className="memory-card glass">
      <div className="memory-card-top">
        <span className={`badge badge-kind-${memory.kind}`}>{memory.kind}</span>
        <span className="chip">{memory.scope}</span>
        <span className="memory-time">{timeAgo(memory.updatedAt)}</span>
      </div>
      {editing ? (
        <textarea
          className="memory-edit"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      ) : (
        <p className="memory-content">{memory.content}</p>
      )}
      <div className="confidence-row">
        <span className="confidence-label">confidence</span>
        <div className="confidence-bar">
          <div
            className="confidence-fill"
            style={{ width: `${confidencePct}%` }}
          />
        </div>
        <span className="confidence-value">{confidencePct}%</span>
      </div>
      {memory.source && <span className="memory-source">{memory.source}</span>}
      <div className="memory-meta">
        <span>created {timeAgo(memory.createdAt)}</span>
        {memory.updatedAt !== memory.createdAt && (
          <span>updated {timeAgo(memory.updatedAt)}</span>
        )}
        {memory.expiresAt && <span>expires {timeAgo(memory.expiresAt)}</span>}
      </div>
      {memory.tags.length > 0 && (
        <div className="chip-row">
          {memory.tags.map((tag) => (
            <span key={tag} className="chip">
              {tag}
            </span>
          ))}
        </div>
      )}
      <div className="memory-actions">
        {editing ? (
          <>
            <button className="btn btn-sm btn-accent" onClick={() => void save()}>
              Save
            </button>
            <button
              className="btn btn-sm"
              onClick={() => {
                setDraft(memory.content);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              className="btn btn-sm"
              onClick={() => {
                setDraft(memory.content);
                setEditing(true);
              }}
            >
              <IconPencil size={13} />
              Edit
            </button>
            <button
              className="btn btn-sm btn-danger"
              onClick={() => void forget()}
            >
              <IconTrash size={13} />
              Forget
            </button>
          </>
        )}
      </div>
      {error && <p className="memory-error">{error}</p>}
    </li>
  );
}

export function MemoryView() {
  const memories = useStore((s) => s.memories);
  const memoryFilter = useStore((s) => s.memoryFilter);
  const fetchMemories = useStore((s) => s.fetchMemories);
  const setMemoryFilter = useStore((s) => s.setMemoryFilter);
  const addMemory = useStore((s) => s.addMemory);

  const [query, setQuery] = useState(memoryFilter.q);
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<MemoryKind>("episodic");
  const [confidence, setConfidence] = useState(0.8);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchMemories().catch(() => {});
  }, [fetchMemories]);

  useEffect(() => {
    if (query === memoryFilter.q) return;
    const timer = window.setTimeout(() => {
      setMemoryFilter({ q: query });
      void fetchMemories().catch(() => {});
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, memoryFilter.q, setMemoryFilter, fetchMemories]);

  const pickKind = (next: "all" | MemoryKind) => {
    setMemoryFilter({ kind: next });
    void fetchMemories().catch(() => {});
  };

  const add = async () => {
    const text = content.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      await addMemory({ content: text, kind, confidence });
      setContent("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "add failed");
    } finally {
      setBusy(false);
    }
  };

  const sorted = [...memories].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );

  return (
    <div className="view">
      <header className="view-header">
        <h2 className="view-title">Memory</h2>
      </header>

      <section className="memory-form glass">
        <div className="field">
          <label htmlFor="memory-content">New memory</label>
          <textarea
            id="memory-content"
            value={content}
            placeholder="Something worth remembering…"
            onChange={(e) => setContent(e.target.value)}
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="memory-kind">Kind</label>
            <select
              id="memory-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as MemoryKind)}
            >
              <option value="episodic">Episodic</option>
              <option value="semantic">Semantic</option>
              <option value="procedural">Procedural</option>
            </select>
          </div>
          <div className="field grow">
            <label htmlFor="memory-confidence">
              Confidence: {Math.round(confidence * 100)}%
            </label>
            <input
              id="memory-confidence"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={confidence}
              onChange={(e) => setConfidence(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="settings-actions">
          <button
            className="btn btn-accent"
            onClick={() => void add()}
            disabled={busy || !content.trim()}
          >
            <IconPlus size={16} />
            Add memory
          </button>
        </div>
        {error && <p className="memory-error">{error}</p>}
      </section>

      <div className="memory-filters">
        {KIND_FILTERS.map((kindFilter) => (
          <button
            key={kindFilter}
            className={`filter-pill ${
              memoryFilter.kind === kindFilter ? "active" : ""
            }`}
            onClick={() => pickKind(kindFilter)}
          >
            {kindFilter === "all" ? "All" : kindFilter}
          </button>
        ))}
        <input
          className="memory-search"
          type="search"
          placeholder="Search memories…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {sorted.length === 0 ? (
        <div className="empty">
          <IconMemory size={36} />
          <p>
            No memories yet — they are extracted automatically after tasks, or
            add one manually.
          </p>
        </div>
      ) : (
        <ul className="memory-list">
          {sorted.map((memory) => (
            <MemoryCard key={memory.id} memory={memory} />
          ))}
        </ul>
      )}
    </div>
  );
}

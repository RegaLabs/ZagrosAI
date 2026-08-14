import { newId, now, type Memory } from "@zagros/domain";
import type { Repos } from "@zagros/runtime";

export interface MemoryCandidate {
  content: string;
  kind: Memory["kind"];
  scope: Memory["scope"];
  confidence: number;
  source?: string;
  tags?: string[];
  expiresAt?: string;
}

const STOPWORDS = new Set([
  "the", "and", "for", "you", "your", "with", "that", "this", "have", "what", "when", "where", "which",
  "please", "using", "about", "from", "into", "will", "would", "should", "could", "then", "than", "there",
  "their", "them", "they", "were", "was", "are", "has", "had", "not", "but", "can", "use", "tell", "know",
]);

function tokenize(text: string): Set<string> {
  if (typeof text !== "string" || !text.trim()) return new Set();
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

export function overlapScore(a: string, b: string): number {
  if (!a || !b) return 0;
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }
  if (intersection === 0) return 0;
  const coverage = intersection / setA.size;
  const union = setA.size + setB.size - intersection;
  const jaccard = union > 0 ? intersection / union : 0;
  return 0.7 * coverage + 0.3 * jaccard;
}

export class MemoryManager {
  constructor(private readonly repos: Repos) {}

  async list(limit = 200): Promise<Memory[]> {
    return this.repos.listMemories(limit);
  }

  async get(id: string): Promise<Memory | undefined> {
    return this.repos.getMemory(id);
  }

  async create(candidate: MemoryCandidate): Promise<Memory> {
    const timestamp = now();
    const memory: Memory = {
      id: newId("mem"),
      kind: candidate.kind,
      scope: candidate.scope,
      content: candidate.content,
      confidence: candidate.confidence,
      source: candidate.source,
      tags: candidate.tags ?? [],
      expiresAt: candidate.expiresAt,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.repos.saveMemory(memory);
    return memory;
  }

  async update(id: string, patch: Partial<Pick<Memory, "content" | "kind" | "scope" | "confidence" | "expiresAt" | "tags">>): Promise<Memory | undefined> {
    const existing = await this.repos.getMemory(id);
    if (!existing) return undefined;
    const updated: Memory = { ...existing, ...patch, updatedAt: now() };
    await this.repos.saveMemory(updated);
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    const existing = await this.repos.getMemory(id);
    if (!existing) return false;
    await this.repos.deleteMemory(id);
    return true;
  }

  async search(query: string, opts?: { limit?: number; kind?: Memory["kind"]; scope?: Memory["scope"] }): Promise<Memory[]> {
    const all = await this.repos.listMemories(500);
    const nowMs = Date.now();
    const candidates = all.filter((m) => {
      if (m.expiresAt) {
        const parsed = Date.parse(m.expiresAt);
        if (!Number.isNaN(parsed) && parsed <= nowMs) return false;
      }
      if (opts?.kind && m.kind !== opts.kind) return false;
      if (opts?.scope && m.scope !== opts.scope) return false;
      return true;
    });
    const scored = candidates
      .map((m) => {
        const text = `${m.content} ${(m.tags ?? []).join(" ")}`;
        const baseScore = overlapScore(query, text);
        const confidenceWeight = 0.75 + 0.25 * (typeof m.confidence === "number" ? Math.min(1, Math.max(0, m.confidence)) : 0.7);
        return { memory: m, score: baseScore * confidenceWeight };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, opts?.limit ?? 8).map((s) => s.memory);
  }

  async sweepExpired(): Promise<number> {
    const all = await this.repos.listMemories(500);
    const nowMs = Date.now();
    let count = 0;
    for (const m of all) {
      if (m.expiresAt) {
        const parsed = Date.parse(m.expiresAt);
        if (!Number.isNaN(parsed) && parsed <= nowMs) {
          await this.repos.deleteMemory(m.id);
          count++;
        }
      }
    }
    return count;
  }

  async propose(candidate: MemoryCandidate): Promise<{ action: "stored" | "merged" | "ignored" | "ask_user"; memoryId?: string }> {
    if (!candidate.content || typeof candidate.content !== "string" || !candidate.content.trim()) {
      return { action: "ignored" };
    }
    const confidence = typeof candidate.confidence === "number" ? candidate.confidence : 0.7;
    if (confidence < 0.5) {
      return { action: "ignored" };
    }
    const nowMs = Date.now();
    const existing = await this.repos.listMemories(500);
    for (const memory of existing) {
      if (memory.expiresAt) {
        const parsed = Date.parse(memory.expiresAt);
        if (!Number.isNaN(parsed) && parsed <= nowMs) continue;
      }
      const isSameKind = !candidate.kind || memory.kind === candidate.kind;
      const isSameScope = !candidate.scope || memory.scope === candidate.scope;
      if (isSameKind && isSameScope) {
        const score = overlapScore(candidate.content, memory.content);
        if (score > 0.65) {
          if (confidence > (memory.confidence ?? 0)) {
            const mergedTags = Array.from(new Set([...(memory.tags ?? []), ...(candidate.tags ?? [])]));
            await this.repos.saveMemory({
              ...memory,
              content: candidate.content,
              confidence,
              source: candidate.source ?? memory.source,
              tags: mergedTags,
              updatedAt: now(),
            });
            return { action: "merged", memoryId: memory.id };
          }
          return { action: "ignored", memoryId: memory.id };
        } else if (score > 0.4 && confidence < 0.7) {
          return { action: "ask_user", memoryId: memory.id };
        }
      }
    }
    const created = await this.create({ ...candidate, confidence });
    return { action: "stored", memoryId: created.id };
  }
}

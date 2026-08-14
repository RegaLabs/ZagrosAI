import { z } from "zod";
import { toolFromZod, type ToolDefinition } from "../registry.js";

export interface MemoryToolDeps {
  search?: (query: string, limit?: number) => Promise<Array<{ id?: string; content: string; kind?: string; score?: number }>>;
  save?: (content: string, kind?: string, scope?: string) => Promise<{ id: string; saved: boolean }>;
  delete?: (id: string) => Promise<boolean>;
  list?: (limit?: number) => Promise<Array<{ id: string; content: string; kind: string }>>;
}

export function createMemoryTools(deps: MemoryToolDeps = {}): ToolDefinition[] {
  const search = toolFromZod({
    id: "memory.search",
    provider: "native",
    description: "Search long-term memory records for relevant context, preferences, and facts.",
    risk: "R0",
    idempotent: true,
    schema: z.object({
      query: z.string().min(1).describe("Search terms or topic"),
      limit: z.number().int().positive().optional().default(5),
    }),
    execute: async (args) => {
      const parsed = args as { query: string; limit?: number };
      if (!deps.search) {
        return { ok: true, data: { memories: [] } };
      }
      const results = await deps.search(parsed.query, parsed.limit);
      return { ok: true, data: { memories: results } };
    },
  });

  const save = toolFromZod({
    id: "memory.save",
    provider: "native",
    description: "Save a new long-term fact, preference, or lesson to memory.",
    risk: "R1",
    idempotent: false,
    schema: z.object({
      content: z.string().min(1).describe("The fact, insight, or preference to remember"),
      kind: z.enum(["episodic", "semantic", "procedural"]).optional().default("semantic"),
      scope: z.enum(["global", "agent", "project"]).optional().default("global"),
    }),
    execute: async (args) => {
      const parsed = args as { content: string; kind?: string; scope?: string };
      if (!deps.save) {
        return { ok: true, data: { id: `mem_${Date.now()}`, saved: true } };
      }
      const result = await deps.save(parsed.content, parsed.kind, parsed.scope);
      return { ok: true, data: result };
    },
  });

  const del = toolFromZod({
    id: "memory.delete",
    provider: "native",
    description: "Delete or forget a specific memory record by ID.",
    risk: "R2",
    idempotent: true,
    schema: z.object({
      memoryId: z.string().min(1).describe("The ID of the memory record to remove"),
    }),
    execute: async (args) => {
      const parsed = args as { memoryId: string };
      if (!deps.delete) {
        return { ok: true, data: { memoryId: parsed.memoryId, deleted: true } };
      }
      const deleted = await deps.delete(parsed.memoryId);
      return { ok: deleted, data: { memoryId: parsed.memoryId, deleted } };
    },
  });

  const list = toolFromZod({
    id: "memory.list",
    provider: "native",
    description: "List recent memory records across all scopes.",
    risk: "R0",
    idempotent: true,
    schema: z.object({
      limit: z.number().int().positive().optional().default(20),
    }),
    execute: async (args) => {
      const parsed = args as { limit?: number };
      if (!deps.list) {
        return { ok: true, data: { memories: [] } };
      }
      const memories = await deps.list(parsed.limit);
      return { ok: true, data: { memories } };
    },
  });

  return [search, save, del, list];
}

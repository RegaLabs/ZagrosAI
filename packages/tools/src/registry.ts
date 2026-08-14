import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const riskLevelSchema = z.enum(["R0", "R1", "R2", "R3"]);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  workerId?: string;
}

export interface ToolContext {
  cwd?: string;
  requestId?: string;
  allowedPaths?: string[];
  agentId?: string;
  conversationId?: string;
  signal?: AbortSignal;
}

export type ToolExecutor = (args: unknown, ctx: ToolContext) => Promise<ToolResult>;

export interface ToolDefinition {
  id: string;
  provider: "native" | "runner" | "mcp";
  description: string;
  schema: Record<string, unknown>;
  risk: RiskLevel;
  idempotent: boolean;
  secrets?: string[];
  execute: ToolExecutor;
}

export function toolFromZod(def: Omit<ToolDefinition, "schema" | "execute"> & { schema: z.ZodTypeAny; execute: ToolExecutor }): ToolDefinition {
  return {
    ...def,
    schema: zodToJsonSchema(def.schema, { name: def.id }) as Record<string, unknown>,
  };
}

export class ToolError extends Error {
  constructor(
    message: string,
    readonly toolId: string,
    readonly risk: RiskLevel
  ) {
    super(message);
    this.name = "ToolError";
  }
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.id)) throw new Error(`Tool already registered: ${tool.id}`);
    this.tools.set(tool.id, tool);
  }

  registerMany(tools: ToolDefinition[]): void {
    for (const tool of tools) this.register(tool);
  }

  remove(id: string): void {
    this.tools.delete(id);
  }

  get(id: string): ToolDefinition | undefined {
    return this.tools.get(id);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  async execute(id: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(id);
    if (!tool) {
      return { ok: false, error: `Unknown tool: ${id}` };
    }
    try {
      return await tool.execute(args, ctx);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

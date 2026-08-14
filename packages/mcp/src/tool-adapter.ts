import type { ToolDefinition } from "@zagros/tools";
import type { McpClient, McpToolInfo } from "./types.js";

export function createMcpToolDefinition(
  client: McpClient,
  info: McpToolInfo,
  risk: "R0" | "R1" | "R2" | "R3" = "R1"
): ToolDefinition {
  return {
    id: info.name,
    provider: "mcp",
    description: info.description,
    schema: info.inputSchema,
    idempotent: false,
    risk,
    execute: async (args) => {
      try {
        const result = await client.callTool(info.name, args);
        if (!result.ok) {
          return { ok: false, error: result.text };
        }
        const data: Record<string, unknown> = { text: result.text };
        const parsed = tryParseJson(result.text);
        if (parsed !== undefined) {
          data.parsed = parsed;
        }
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

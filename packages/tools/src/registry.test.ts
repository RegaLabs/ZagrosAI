import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ToolRegistry, toolFromZod, ToolError } from "./registry.js";

describe("ToolRegistry", () => {
  it("registers and retrieves tools", () => {
    const registry = new ToolRegistry();
    const tool = toolFromZod({
      id: "test.tool",
      provider: "native",
      description: "Test tool",
      risk: "R0",
      idempotent: true,
      schema: z.object({ input: z.string() }),
      execute: async (args) => ({ ok: true, data: args }),
    });

    registry.register(tool);
    expect(registry.get("test.tool")).toBe(tool);
    expect(registry.list()).toHaveLength(1);
  });

  it("throws when registering duplicate tools", () => {
    const registry = new ToolRegistry();
    const tool = toolFromZod({
      id: "test.dup",
      provider: "native",
      description: "Dup tool",
      risk: "R0",
      idempotent: true,
      schema: z.object({}),
      execute: async () => ({ ok: true }),
    });

    registry.register(tool);
    expect(() => registry.register(tool)).toThrow(/already registered/);
  });

  it("handles tool execution and context passing", async () => {
    const registry = new ToolRegistry();
    const tool = toolFromZod({
      id: "test.ctx",
      provider: "native",
      description: "Context test tool",
      risk: "R0",
      idempotent: true,
      schema: z.object({}),
      execute: async (_args, ctx) => ({ ok: true, data: { cwd: ctx.cwd, agentId: ctx.agentId } }),
    });

    registry.register(tool);
    const res = await registry.execute("test.ctx", {}, { cwd: "/my/workspace", agentId: "agent-1" });
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ cwd: "/my/workspace", agentId: "agent-1" });
  });

  it("returns unknown tool error when tool is missing", async () => {
    const registry = new ToolRegistry();
    const res = await registry.execute("missing.tool", {}, {});
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Unknown tool: missing.tool");
  });
});

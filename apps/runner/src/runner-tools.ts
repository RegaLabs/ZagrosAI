import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { browserToolMeta, filesListToolMeta, resolveWithin, toolFromZod, type ToolDefinition, type ToolContext } from "@zagros/tools";
import { z } from "zod";
import type { BrowserManager } from "./browser.js";

export function createFilesListTool(workspaceDir: string): ToolDefinition {
  return {
    ...toolFromZod({
      id: filesListToolMeta.id,
      provider: "native",
      description: filesListToolMeta.description,
      risk: filesListToolMeta.risk,
      idempotent: true,
      schema: z.object({ path: z.string().default(".") }),
      execute: async (rawArgs, ctx: ToolContext) => {
        if (ctx.signal?.aborted) {
          return { ok: false, error: "Operation aborted" };
        }
        const args = rawArgs as { path?: string };
        const root = ctx.cwd ?? workspaceDir;
        let target: string;
        try {
          target = resolveWithin(root, args.path ?? ".", "files.list");
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
        try {
          const entries = await readdir(target, { withFileTypes: true });
          const rows = [];
          for (const entry of entries) {
            const full = resolve(target, entry.name);
            const info = await stat(full).catch(() => undefined);
            rows.push({
              name: entry.name,
              type: entry.isDirectory() ? "directory" : "file",
              size: info?.size ?? null,
            });
          }
          return { ok: true, data: { path: target, entries: rows } };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
    schema: filesListToolMeta.schema,
  };
}

export function createBrowserTools(browser: BrowserManager): ToolDefinition[] {
  const metaById = new Map(browserToolMeta.map((meta) => [meta.id, meta]));
  return [
    toolFromZod({
      id: "browser.session.create",
      provider: "native",
      description: metaById.get("browser.session.create")!.description,
      risk: "R1",
      idempotent: false,
      schema: z.object({ profile: z.string().optional() }),
      execute: async (rawArgs) => {
        const args = rawArgs as { profile?: string };
        try {
          return { ok: true, data: await browser.createSession(args.profile) };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
    toolFromZod({
      id: "browser.session.list",
      provider: "native",
      description: metaById.get("browser.session.list")!.description,
      risk: "R0",
      idempotent: true,
      schema: z.object({}),
      execute: async () => ({ ok: true, data: { sessions: browser.list() } }),
    }),
    toolFromZod({
      id: "browser.session.close",
      provider: "native",
      description: metaById.get("browser.session.close")!.description,
      risk: "R1",
      idempotent: true,
      schema: z.object({ sessionId: z.string().min(1) }),
      execute: async (rawArgs) => {
        const args = rawArgs as { sessionId: string };
        const closed = await browser.closeSession(args.sessionId);
        return closed ? { ok: true, data: { ok: true } } : { ok: false, error: `Browser session not found: ${args.sessionId}` };
      },
    }),
    toolFromZod({
      id: "browser.navigate",
      provider: "native",
      description: metaById.get("browser.navigate")!.description,
      risk: "R0",
      idempotent: false,
      schema: z.object({ sessionId: z.string().min(1), url: z.string().url() }),
      execute: async (rawArgs) => {
        const args = rawArgs as { sessionId: string; url: string };
        try {
          return { ok: true, data: await browser.navigate(args.sessionId, args.url) };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
    toolFromZod({
      id: "browser.screenshot",
      provider: "native",
      description: metaById.get("browser.screenshot")!.description,
      risk: "R0",
      idempotent: true,
      schema: z.object({ sessionId: z.string().min(1), fullPage: z.boolean().default(false) }),
      execute: async (rawArgs) => {
        const args = rawArgs as { sessionId: string; fullPage?: boolean };
        try {
          return { ok: true, data: await browser.screenshot(args.sessionId, args.fullPage ?? false) };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
    toolFromZod({
      id: "browser.text",
      provider: "native",
      description: metaById.get("browser.text")!.description,
      risk: "R0",
      idempotent: true,
      schema: z.object({ sessionId: z.string().min(1), selector: z.string().optional() }),
      execute: async (rawArgs) => {
        const args = rawArgs as { sessionId: string; selector?: string };
        try {
          return { ok: true, data: await browser.text(args.sessionId, args.selector) };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
    toolFromZod({
      id: "browser.click",
      provider: "native",
      description: metaById.get("browser.click")!.description,
      risk: "R1",
      idempotent: false,
      schema: z.object({ sessionId: z.string().min(1), selector: z.string().min(1) }),
      execute: async (rawArgs) => {
        const args = rawArgs as { sessionId: string; selector: string };
        try {
          return { ok: true, data: await browser.click(args.sessionId, args.selector) };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
    toolFromZod({
      id: "browser.type",
      provider: "native",
      description: metaById.get("browser.type")!.description,
      risk: "R1",
      idempotent: false,
      schema: z.object({ sessionId: z.string().min(1), selector: z.string().min(1), text: z.string(), submit: z.boolean().default(false) }),
      execute: async (rawArgs) => {
        const args = rawArgs as { sessionId: string; selector: string; text: string; submit?: boolean };
        try {
          return { ok: true, data: await browser.type(args.sessionId, args.selector, args.text, args.submit ?? false) };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
    toolFromZod({
      id: "browser.evaluate",
      provider: "native",
      description: metaById.get("browser.evaluate")!.description,
      risk: "R1",
      idempotent: false,
      schema: z.object({ sessionId: z.string().min(1), script: z.string().min(1) }),
      execute: async (rawArgs) => {
        const args = rawArgs as { sessionId: string; script: string };
        try {
          return { ok: true, data: await browser.evaluate(args.sessionId, args.script) };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  ];
}

import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { z } from "zod";
import { toolFromZod, ToolError, type ToolContext } from "../registry.js";

export const MAX_READ_BYTES = 8 * 1024 * 1024; // 8MB
export const MAX_WRITE_BYTES = 10 * 1024 * 1024; // 10MB

export function resolveWithin(cwd: string, requested: string, toolId = "files"): string {
  if (typeof requested !== "string" || requested.includes("\0")) {
    throw new ToolError("invalid path: path must not contain null bytes", toolId, "R1");
  }
  const base = resolve(cwd);
  const target = resolve(base, requested);
  const rel = relative(base, target);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
    throw new ToolError(`path escapes workspace root: ${requested}`, toolId, "R1");
  }

  if (existsSync(base)) {
    const realBase = realpathSync(base);
    if (existsSync(target)) {
      const realTarget = realpathSync(target);
      const realRel = relative(realBase, realTarget);
      if (realRel === ".." || realRel.startsWith(".." + sep) || isAbsolute(realRel)) {
        throw new ToolError(`path escapes workspace root via symlink: ${requested}`, toolId, "R1");
      }
    } else {
      let curr = dirname(target);
      while (curr !== base && !existsSync(curr)) {
        const parent = dirname(curr);
        if (parent === curr) break;
        curr = parent;
      }
      if (existsSync(curr)) {
        const realAncestor = realpathSync(curr);
        const realRel = relative(realBase, realAncestor);
        if (realRel === ".." || realRel.startsWith(".." + sep) || isAbsolute(realRel)) {
          throw new ToolError(`path directory escapes workspace root via symlink: ${requested}`, toolId, "R1");
        }
      }
    }
  }

  return target;
}

export function createFileTools(cwd?: string) {
  const root = cwd ?? process.cwd();

  const filesRead = toolFromZod({
    id: "files.read",
    provider: "native",
    description:
      "Read a file from the workspace and return its contents. Use for source files, configs, logs and documents. Binary files are returned as base64.",
    risk: "R0",
    idempotent: true,
    schema: z.object({
      path: z.string().min(1),
      maxBytes: z.number().int().min(1).max(MAX_READ_BYTES).default(MAX_READ_BYTES),
    }),
    execute: async (rawArgs, ctx: ToolContext) => {
      if (ctx.signal?.aborted) {
        return { ok: false, error: "Operation aborted" };
      }
      const fs = await import("node:fs/promises");
      const args = rawArgs as { path: string; maxBytes?: number };
      const base = ctx.cwd ?? root;
      let target: string;
      try {
        target = resolveWithin(base, args.path, "files.read");
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      try {
        const stat = await fs.stat(target);
        if (stat.isDirectory()) {
          const entries = await fs.readdir(target, { withFileTypes: true });
          return {
            ok: true,
            data: {
              directory: true,
              entries: entries.map((e) => ({
                name: e.name,
                type: e.isDirectory() ? "directory" : "file",
              })),
            },
          };
        }
        const limit = Math.min(args.maxBytes ?? MAX_READ_BYTES, MAX_READ_BYTES);
        const buffer = await fs.readFile(target, { signal: ctx.signal });
        const truncated = buffer.length > limit;
        const slice = buffer.subarray(0, limit);
        const looksBinary = slice.includes(0);
        return {
          ok: true,
          data: {
            path: target,
            size: buffer.length,
            truncated,
            content: looksBinary ? slice.toString("base64") : slice.toString("utf-8"),
            encoding: looksBinary ? "base64" : "utf-8",
          },
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  const filesWrite = toolFromZod({
    id: "files.write",
    provider: "native",
    description:
      "Write content to a file in the workspace, creating parent directories as needed. Overwrites existing files.",
    risk: "R1",
    idempotent: true,
    schema: z.object({
      path: z.string().min(1),
      content: z.string().max(MAX_WRITE_BYTES, `Content exceeds maximum write size of ${MAX_WRITE_BYTES / (1024 * 1024)}MB`),
    }),
    execute: async (rawArgs, ctx: ToolContext) => {
      if (ctx.signal?.aborted) {
        return { ok: false, error: "Operation aborted" };
      }
      const fs = await import("node:fs/promises");
      const args = rawArgs as { path: string; content: string };
      const base = ctx.cwd ?? root;
      let target: string;
      try {
        target = resolveWithin(base, args.path, "files.write");
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      try {
        await fs.mkdir(dirname(target), { recursive: true });
        await fs.writeFile(target, args.content, { encoding: "utf-8", signal: ctx.signal });
        const stat = await fs.stat(target);
        return { ok: true, data: { path: target, bytesWritten: stat.size } };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  return [filesRead, filesWrite];
}


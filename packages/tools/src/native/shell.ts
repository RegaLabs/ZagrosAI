import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { toolFromZod, type ToolContext } from "../registry.js";
import { resolveWithin } from "./files.js";

export const MAX_OUTPUT_BYTES = 512 * 1024; // 512 KB

function terminateProcessGroup(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
  if (!child.pid || child.killed) return;
  const isWindows = process.platform === "win32";
  try {
    if (isWindows) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      try {
        process.kill(-child.pid, signal);
      } catch {
        child.kill(signal);
      }
    }
  } catch {
    // Process already exited
  }
}

export function createShellTool(cwd?: string, wrapper?: string) {
  const root = cwd ?? process.cwd();

  return toolFromZod({
    id: "shell.exec",
    provider: "native",
    description:
      "Execute a command in the system shell. Use for running tests, git commands, package managers, scripts, or any terminal operation. Returns stdout, stderr and exit code. The working directory defaults to the agent workspace.",
    risk: "R1",
    idempotent: false,
    schema: z.object({
      command: z.string().min(1).max(8192),
      cwd: z.string().optional(),
      timeoutMs: z.number().int().min(100).max(600000).default(120000),
    }),
    execute: async (rawArgs, ctx: ToolContext) => {
      if (ctx.signal?.aborted) {
        return { ok: false, error: "Operation aborted" };
      }

      const args = rawArgs as { command: string; cwd?: string; timeoutMs?: number };
      const baseRoot = ctx.cwd ?? root;
      let effectiveCwd = baseRoot;

      if (args.cwd) {
        try {
          effectiveCwd = resolveWithin(baseRoot, args.cwd, "shell.exec");
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }

      if (!existsSync(effectiveCwd)) {
        return { ok: false, error: `working directory does not exist: ${effectiveCwd}` };
      }

      const finalCommand = wrapper ? `${wrapper} ${args.command}` : args.command;
      const timeoutMs = args.timeoutMs ?? 120_000;
      const isWindows = process.platform === "win32";

      return new Promise((resolveResult) => {
        let timedOut = false;
        let killed = false;
        let forceKillTimer: NodeJS.Timeout | undefined;

        const child = spawn(finalCommand, {
          cwd: effectiveCwd,
          shell: true,
          detached: !isWindows,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: process.env,
        });

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let truncated = false;

        child.stdout?.on("data", (chunk: Buffer) => {
          if (stdoutBytes < MAX_OUTPUT_BYTES) {
            const remaining = MAX_OUTPUT_BYTES - stdoutBytes;
            if (chunk.length <= remaining) {
              stdoutChunks.push(chunk);
              stdoutBytes += chunk.length;
            } else {
              stdoutChunks.push(chunk.subarray(0, remaining));
              stdoutBytes += remaining;
              truncated = true;
            }
          } else {
            truncated = true;
          }
        });

        child.stderr?.on("data", (chunk: Buffer) => {
          if (stderrBytes < MAX_OUTPUT_BYTES) {
            const remaining = MAX_OUTPUT_BYTES - stderrBytes;
            if (chunk.length <= remaining) {
              stderrChunks.push(chunk);
              stderrBytes += chunk.length;
            } else {
              stderrChunks.push(chunk.subarray(0, remaining));
              stderrBytes += remaining;
              truncated = true;
            }
          } else {
            truncated = true;
          }
        });

        const timeoutTimer = setTimeout(() => {
          timedOut = true;
          terminateProcessGroup(child, "SIGTERM");
          forceKillTimer = setTimeout(() => {
            terminateProcessGroup(child, "SIGKILL");
          }, 2000);
          forceKillTimer.unref?.();
        }, timeoutMs);
        timeoutTimer.unref?.();

        const onAbort = (): void => {
          killed = true;
          terminateProcessGroup(child, "SIGTERM");
          forceKillTimer = setTimeout(() => {
            terminateProcessGroup(child, "SIGKILL");
          }, 1000);
          forceKillTimer.unref?.();
        };

        if (ctx.signal) {
          ctx.signal.addEventListener("abort", onAbort, { once: true });
        }

        const cleanup = (): void => {
          clearTimeout(timeoutTimer);
          if (forceKillTimer) clearTimeout(forceKillTimer);
          if (ctx.signal) {
            ctx.signal.removeEventListener("abort", onAbort);
          }
        };

        child.on("error", (err) => {
          cleanup();
          const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
          const stderr = Buffer.concat(stderrChunks).toString("utf-8");
          resolveResult({
            ok: false,
            data: {
              exitCode: 1,
              stdout,
              stderr: stderr || err.message,
              truncated,
              timedOut,
              killed,
            },
            error: err.message,
          });
        });

        child.on("close", (code, signal) => {
          cleanup();
          const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
          const stderr = Buffer.concat(stderrChunks).toString("utf-8");
          const effectiveExitCode = code !== null ? code : signal ? 128 : 1;

          if (timedOut) {
            resolveResult({
              ok: false,
              data: {
                exitCode: 124,
                stdout,
                stderr: stderr || `Process timed out after ${timeoutMs}ms`,
                truncated,
                timedOut: true,
                killed: false,
              },
              error: `shell execution timed out after ${timeoutMs}ms`,
            });
            return;
          }

          if (killed) {
            resolveResult({
              ok: false,
              data: {
                exitCode: 130,
                stdout,
                stderr: stderr || "Process execution was aborted",
                truncated,
                timedOut: false,
                killed: true,
              },
              error: "shell execution aborted",
            });
            return;
          }

          if (effectiveExitCode !== 0) {
            resolveResult({
              ok: false,
              data: {
                exitCode: effectiveExitCode,
                stdout,
                stderr,
                truncated,
                timedOut: false,
                killed: false,
              },
              error: `shell execution failed with exit code ${effectiveExitCode}`,
            });
            return;
          }

          resolveResult({
            ok: true,
            data: {
              exitCode: 0,
              stdout,
              stderr,
              truncated,
              timedOut: false,
              killed: false,
            },
          });
        });
      });
    },
  });
}


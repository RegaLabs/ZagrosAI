import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createShellTool } from "./shell.js";

describe("createShellTool hardening and execution", () => {
  let tempDir: string;
  let subDir: string;
  let shellTool: ReturnType<typeof createShellTool>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "zagros-shell-test-"));
    subDir = join(tempDir, "subdir");
    mkdirSync(subDir, { recursive: true });
    shellTool = createShellTool(tempDir);
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("executes a basic command successfully", async () => {
    const res = await shellTool.execute({ command: "echo 'hello zagros'" }, { cwd: tempDir });
    expect(res.ok).toBe(true);
    const data = res.data as { exitCode: number; stdout: string; stderr: string; truncated: boolean };
    expect(data.exitCode).toBe(0);
    expect(data.stdout.trim()).toBe("hello zagros");
    expect(data.truncated).toBe(false);
  });

  it("captures non-zero exit codes and stderr", async () => {
    const res = await shellTool.execute({ command: "echo 'failure message' >&2; exit 7" }, { cwd: tempDir });
    expect(res.ok).toBe(false);
    const data = res.data as { exitCode: number; stdout: string; stderr: string };
    expect(data.exitCode).toBe(7);
    expect(data.stderr).toContain("failure message");
  });

  it("enforces working directory sandboxing", async () => {
    const res = await shellTool.execute(
      { command: "pwd", cwd: "../outside" },
      { cwd: tempDir }
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/escapes workspace root/);
  });

  it("executes in a valid sub-directory within workspace", async () => {
    const res = await shellTool.execute(
      { command: "pwd", cwd: "subdir" },
      { cwd: tempDir }
    );
    expect(res.ok).toBe(true);
    const data = res.data as { stdout: string };
    expect(data.stdout.trim()).toContain("subdir");
  });

  it("enforces timeout and terminates the process cleanly", async () => {
    const start = Date.now();
    const res = await shellTool.execute(
      { command: "sleep 10", timeoutMs: 300 },
      { cwd: tempDir }
    );
    const elapsed = Date.now() - start;

    expect(res.ok).toBe(false);
    expect(elapsed).toBeLessThan(4000); // Should terminate promptly, well before 10s
    const data = res.data as { exitCode: number; timedOut: boolean };
    expect(data.timedOut).toBe(true);
    expect(data.exitCode).toBe(124);
  });

  it("terminates process group on AbortSignal cancellation", async () => {
    const controller = new AbortController();
    const start = Date.now();

    setTimeout(() => {
      controller.abort();
    }, 150);

    const res = await shellTool.execute(
      { command: "sleep 10" },
      { cwd: tempDir, signal: controller.signal }
    );
    const elapsed = Date.now() - start;

    expect(res.ok).toBe(false);
    expect(elapsed).toBeLessThan(3000);
    const data = res.data as { exitCode: number; killed: boolean };
    expect(data.killed).toBe(true);
    expect(data.exitCode).toBe(130);
  });

  it("handles output buffer truncation without crashing", async () => {
    // Generate > 600KB of output (MAX_OUTPUT_BYTES is 512KB)
    const res = await shellTool.execute(
      { command: "node -e 'process.stdout.write(\"A\".repeat(600 * 1024))'" },
      { cwd: tempDir }
    );
    expect(res.ok).toBe(true);
    const data = res.data as { stdout: string; truncated: boolean };
    expect(data.truncated).toBe(true);
    expect(Buffer.byteLength(data.stdout, "utf-8")).toBeLessThanOrEqual(512 * 1024);
  });
});

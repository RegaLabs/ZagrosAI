import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFileTools, resolveWithin, MAX_WRITE_BYTES } from "./files.js";
import { ToolError } from "../registry.js";

describe("resolveWithin sandbox hardening", () => {
  let tempDir: string;
  let subDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "zagros-files-test-"));
    subDir = join(tempDir, "sub");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(tempDir, "hello.txt"), "hello world");
    writeFileSync(join(subDir, "nested.txt"), "nested content");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("allows valid relative and sub-directory paths", () => {
    expect(resolveWithin(tempDir, "hello.txt")).toBe(join(tempDir, "hello.txt"));
    expect(resolveWithin(tempDir, "sub/nested.txt")).toBe(join(subDir, "nested.txt"));
    expect(resolveWithin(tempDir, "./sub/nested.txt")).toBe(join(subDir, "nested.txt"));
    expect(resolveWithin(tempDir, ".")).toBe(tempDir);
  });

  it("rejects path traversal with parent directories (..)", () => {
    expect(() => resolveWithin(tempDir, "../evil.txt")).toThrow(ToolError);
    expect(() => resolveWithin(tempDir, "sub/../../evil.txt")).toThrow(ToolError);
    expect(() => resolveWithin(tempDir, "../../evil.txt")).toThrow(ToolError);
  });

  it("rejects absolute paths outside the workspace root", () => {
    expect(() => resolveWithin(tempDir, "/etc/passwd")).toThrow(ToolError);
    expect(() => resolveWithin(tempDir, "/tmp")).toThrow(ToolError);
  });

  it("rejects paths containing null bytes", () => {
    expect(() => resolveWithin(tempDir, "hello.txt\0evil")).toThrow(ToolError);
  });

  it("rejects symlinks pointing outside workspace root for existing files", () => {
    const outsideFile = join(tmpdir(), "outside-test-target.txt");
    writeFileSync(outsideFile, "secret");
    const symlinkPath = join(tempDir, "symlink-outside.txt");
    symlinkSync(outsideFile, symlinkPath);

    expect(() => resolveWithin(tempDir, "symlink-outside.txt")).toThrow(ToolError);
    expect(() => resolveWithin(tempDir, "symlink-outside.txt")).toThrow(/symlink/);

    rmSync(outsideFile, { force: true });
  });

  it("allows symlinks pointing inside workspace root", () => {
    const symlinkPath = join(tempDir, "symlink-inside.txt");
    symlinkSync(join(tempDir, "hello.txt"), symlinkPath);

    expect(resolveWithin(tempDir, "symlink-inside.txt")).toBe(symlinkPath);
  });

  it("rejects writing to a directory that is a symlink pointing outside", () => {
    const outsideDir = mkdtempSync(join(tmpdir(), "outside-dir-"));
    const symlinkDir = join(tempDir, "sym-dir");
    symlinkSync(outsideDir, symlinkDir);

    expect(() => resolveWithin(tempDir, "sym-dir/newfile.txt")).toThrow(ToolError);

    rmSync(outsideDir, { recursive: true, force: true });
  });
});

describe("createFileTools execution", () => {
  let tempDir: string;
  let filesReadTool: import("../registry.js").ToolDefinition;
  let filesWriteTool: import("../registry.js").ToolDefinition;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "zagros-tool-exec-"));
    const tools = createFileTools(tempDir);
    filesReadTool = tools[0]!;
    filesWriteTool = tools[1]!;
    writeFileSync(join(tempDir, "sample.txt"), "sample file contents");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("reads a file successfully", async () => {
    const res = await filesReadTool.execute({ path: "sample.txt" }, { cwd: tempDir });
    expect(res.ok).toBe(true);
    const data = res.data as { content: string; encoding: string; size: number };
    expect(data.content).toBe("sample file contents");
    expect(data.encoding).toBe("utf-8");
  });

  it("lists directory entries when path is a directory", async () => {
    const res = await filesReadTool.execute({ path: "." }, { cwd: tempDir });
    expect(res.ok).toBe(true);
    const data = res.data as { directory: boolean; entries: Array<{ name: string; type: string }> };
    expect(data.directory).toBe(true);
    expect(data.entries.some((e) => e.name === "sample.txt")).toBe(true);
  });

  it("returns base64 encoding for binary content", async () => {
    const binaryPath = join(tempDir, "binary.bin");
    const buf = Buffer.from([0x00, 0x01, 0x02, 0xff]);
    writeFileSync(binaryPath, buf);

    const res = await filesReadTool.execute({ path: "binary.bin" }, { cwd: tempDir });
    expect(res.ok).toBe(true);
    const data = res.data as { content: string; encoding: string };
    expect(data.encoding).toBe("base64");
    expect(data.content).toBe(buf.toString("base64"));
  });

  it("blocks path escaping on read", async () => {
    const res = await filesReadTool.execute({ path: "../../../etc/passwd" }, { cwd: tempDir });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/escapes workspace root/);
  });

  it("writes a file and creates parent directories", async () => {
    const res = await filesWriteTool.execute(
      { path: "nested/dir/created.txt", content: "new content here" },
      { cwd: tempDir }
    );
    expect(res.ok).toBe(true);
    expect(existsSync(join(tempDir, "nested/dir/created.txt"))).toBe(true);

    const readRes = await filesReadTool.execute({ path: "nested/dir/created.txt" }, { cwd: tempDir });
    expect(readRes.ok).toBe(true);
    expect((readRes.data as { content: string }).content).toBe("new content here");
  });

  it("blocks path escaping on write", async () => {
    const res = await filesWriteTool.execute({ path: "../escape.txt", content: "bad" }, { cwd: tempDir });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/escapes workspace root/);
  });

  it("handles aborted signal on read and write", async () => {
    const controller = new AbortController();
    controller.abort();

    const readRes = await filesReadTool.execute({ path: "sample.txt" }, { cwd: tempDir, signal: controller.signal });
    expect(readRes.ok).toBe(false);
    expect(readRes.error).toBe("Operation aborted");

    const writeRes = await filesWriteTool.execute({ path: "sample.txt", content: "new" }, { cwd: tempDir, signal: controller.signal });
    expect(writeRes.ok).toBe(false);
    expect(writeRes.error).toBe("Operation aborted");
  });
});

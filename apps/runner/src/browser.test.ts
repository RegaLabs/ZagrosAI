import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BrowserManager } from "./browser.js";

describe("BrowserManager hardening and validation", () => {
  let tempDir: string;
  let manager: BrowserManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "zagros-browser-test-"));
    manager = new BrowserManager(tempDir, "chrome");
  });

  afterEach(async () => {
    await manager.closeAll().catch(() => undefined);
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("lists empty sessions initially", () => {
    expect(manager.list()).toEqual([]);
  });

  it("returns false when closing non-existent session", async () => {
    const closed = await manager.closeSession("brows_nonexistent");
    expect(closed).toBe(false);
  });

  it("rejects profile names containing directory traversal or special characters", async () => {
    await expect(manager.createSession("../../etc")).rejects.toThrow(/Invalid browser profile name/);
    await expect(manager.createSession("profile/with/slashes")).rejects.toThrow(/Invalid browser profile name/);
    await expect(manager.createSession("profile name with spaces")).rejects.toThrow(/Invalid browser profile name/);
    await expect(manager.createSession("profile$!*")).rejects.toThrow(/Invalid browser profile name/);
  });

  it("rejects unsupported protocols on navigation", async () => {
    await expect(manager.navigate("brows_test", "file:///etc/passwd")).rejects.toThrow(/Unsupported URL protocol/);
    await expect(manager.navigate("brows_test", "javascript:alert(1)")).rejects.toThrow(/Unsupported URL protocol/);
    await expect(manager.navigate("brows_test", "data:text/html,evil")).rejects.toThrow(/Unsupported URL protocol/);
  });
});

import { describe, expect, it } from "vitest";
import { AcpBridgeManager } from "../bridge-manager.js";
import { CodexAcpBridge } from "./codex.js";
import { ClaudeCodeAcpBridge } from "./claude-code.js";
import { GeminiCliAcpBridge } from "./gemini-cli.js";
import { GenericAcpBridge } from "./generic.js";

describe("ACP Bridges & Bridge Manager", () => {
  it("initializes bridge instances correctly", () => {
    const codex = new CodexAcpBridge();
    expect(codex.name).toBe("codex");

    const claude = new ClaudeCodeAcpBridge();
    expect(claude.name).toBe("claude-code");

    const gemini = new GeminiCliAcpBridge();
    expect(gemini.name).toBe("gemini-cli");

    const generic = new GenericAcpBridge({ name: "custom", command: "echo" });
    expect(generic.name).toBe("custom");
  });

  it("registers and creates default bridges in AcpBridgeManager", async () => {
    const manager = new AcpBridgeManager();
    const codex = manager.createDefaultBridge("codex");
    expect(codex).toBeInstanceOf(CodexAcpBridge);

    const claude = manager.createDefaultBridge("claude-code");
    expect(claude).toBeInstanceOf(ClaudeCodeAcpBridge);

    const gemini = manager.createDefaultBridge("gemini-cli");
    expect(gemini).toBeInstanceOf(GeminiCliAcpBridge);

    expect(manager.getBridge("codex")).toBeDefined();
    await manager.closeAll();
  });
});

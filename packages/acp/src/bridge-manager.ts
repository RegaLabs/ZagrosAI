import { GenericAcpBridge } from "./bridges/generic.js";
import { CodexAcpBridge } from "./bridges/codex.js";
import { ClaudeCodeAcpBridge } from "./bridges/claude-code.js";
import { GeminiCliAcpBridge } from "./bridges/gemini-cli.js";

export class AcpBridgeManager {
  private readonly bridges = new Map<string, GenericAcpBridge>();

  registerBridge(bridge: GenericAcpBridge): void {
    this.bridges.set(bridge.name.toLowerCase(), bridge);
  }

  getBridge(name: string): GenericAcpBridge | undefined {
    return this.bridges.get(name.toLowerCase());
  }

  createDefaultBridge(name: string): GenericAcpBridge {
    const key = name.toLowerCase();
    switch (key) {
      case "codex": {
        const bridge = new CodexAcpBridge();
        this.registerBridge(bridge);
        return bridge;
      }
      case "claude":
      case "claude-code": {
        const bridge = new ClaudeCodeAcpBridge();
        this.registerBridge(bridge);
        return bridge;
      }
      case "gemini":
      case "gemini-cli": {
        const bridge = new GeminiCliAcpBridge();
        this.registerBridge(bridge);
        return bridge;
      }
      default: {
        const bridge = new GenericAcpBridge({ name: key, command: name });
        this.registerBridge(bridge);
        return bridge;
      }
    }
  }

  async closeAll(): Promise<void> {
    for (const bridge of this.bridges.values()) {
      await bridge.close().catch(() => undefined);
    }
    this.bridges.clear();
  }
}

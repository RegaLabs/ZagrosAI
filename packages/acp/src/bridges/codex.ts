import { GenericAcpBridge, type AcpBridgeConfig } from "./generic.js";

export interface CodexBridgeOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  systemPrompt?: string;
}

export class CodexAcpBridge extends GenericAcpBridge {
  constructor(options?: CodexBridgeOptions) {
    const config: AcpBridgeConfig = {
      name: "codex",
      command: options?.command ?? "codex",
      args: options?.args ?? ["acp"],
      cwd: options?.cwd,
      env: options?.env,
      systemPrompt: options?.systemPrompt,
    };
    super(config);
  }
}

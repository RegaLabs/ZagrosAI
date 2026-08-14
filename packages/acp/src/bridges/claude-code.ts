import { GenericAcpBridge, type AcpBridgeConfig } from "./generic.js";

export interface ClaudeCodeBridgeOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  systemPrompt?: string;
}

export class ClaudeCodeAcpBridge extends GenericAcpBridge {
  constructor(options?: ClaudeCodeBridgeOptions) {
    const config: AcpBridgeConfig = {
      name: "claude-code",
      command: options?.command ?? "claude",
      args: options?.args ?? ["--acp"],
      cwd: options?.cwd,
      env: options?.env,
      systemPrompt: options?.systemPrompt,
    };
    super(config);
  }
}

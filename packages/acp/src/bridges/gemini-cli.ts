import { GenericAcpBridge, type AcpBridgeConfig } from "./generic.js";

export interface GeminiCliBridgeOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  systemPrompt?: string;
}

export class GeminiCliAcpBridge extends GenericAcpBridge {
  constructor(options?: GeminiCliBridgeOptions) {
    const config: AcpBridgeConfig = {
      name: "gemini-cli",
      command: options?.command ?? "gemini",
      args: options?.args ?? ["acp"],
      cwd: options?.cwd,
      env: options?.env,
      systemPrompt: options?.systemPrompt,
    };
    super(config);
  }
}

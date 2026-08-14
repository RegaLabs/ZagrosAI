import { GenericAcpBridge } from "./generic.js";

export interface GrokBuildBridgeOptions {
  apiKey?: string;
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
}

export class GrokBuildAcpBridge extends GenericAcpBridge {
  constructor(options: GrokBuildBridgeOptions = {}) {
    const command = options.command ?? "grok";
    const args = ["build", "--acp"];
    const env: Record<string, string> = { ...(options.env ?? {}) };
    if (options.apiKey) env["XAI_API_KEY"] = options.apiKey;

    super({
      name: "grok-build",
      command,
      args,
      cwd: options.cwd,
      env,
    });
  }
}

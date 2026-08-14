import { AcpClient, type AcpOptions } from "../client.js";

export interface AcpBridgeConfig extends AcpOptions {
  name: string;
  systemPrompt?: string;
}

export class GenericAcpBridge {
  readonly name: string;
  private client: AcpClient;
  private activeSessionId?: string;

  constructor(protected readonly config: AcpBridgeConfig) {
    this.name = config.name;
    this.client = new AcpClient({
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      env: config.env,
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async createSession(systemPrompt?: string): Promise<string> {
    const promptToUse = systemPrompt ?? this.config.systemPrompt;
    const { sessionId } = await this.client.sessionNew(promptToUse);
    this.activeSessionId = sessionId;
    return sessionId;
  }

  async prompt(userText: string, sessionId?: string): Promise<{ messageId: string }> {
    const targetSessionId = sessionId ?? this.activeSessionId;
    if (!targetSessionId) {
      throw new Error(`[ACP Bridge:${this.name}] No active session. Call createSession() first.`);
    }
    return this.client.prompt(targetSessionId, userText);
  }

  onUpdate(listener: Parameters<AcpClient["onUpdate"]>[0]): () => void {
    return this.client.onUpdate(listener);
  }

  async close(): Promise<void> {
    if (this.activeSessionId) {
      await this.client.sessionClose(this.activeSessionId).catch(() => undefined);
      this.activeSessionId = undefined;
    }
    await this.client.close();
  }
}

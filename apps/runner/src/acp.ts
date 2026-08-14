import { AcpClient } from "@zagros/acp";

export interface HarnessCommand {
  name: string;
  command: string;
  args: string[];
}

interface HarnessSession {
  client: AcpClient;
  sessionId: string;
}

class AsyncQueue<T> {
  private items: T[] = [];
  private waiters: Array<(item: T | undefined) => void> = [];

  push(item: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(item);
    else this.items.push(item);
  }

  next(): Promise<T | undefined> {
    const item = this.items.shift();
    if (item !== undefined) return Promise.resolve(item);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

export class AcpHarnessHost {
  private readonly sessions = new Map<string, HarnessSession>();
  private readonly clients = new Map<string, AcpClient>();

  constructor(private readonly harnesses: HarnessCommand[]) {}

  names(): string[] {
    return this.harnesses.map((h) => h.name);
  }

  has(name: string): boolean {
    return this.harnesses.some((h) => h.name === name);
  }

  private find(name: string): HarnessCommand {
    const harness = this.harnesses.find((h) => h.name === name);
    if (!harness) throw new Error(`Harness not available on this runner: ${name}`);
    return harness;
  }

  private async clientFor(name: string): Promise<AcpClient> {
    const harness = this.find(name);
    let client = this.clients.get(name);
    if (!client) {
      client = new AcpClient({ command: harness.command, args: harness.args });
      this.clients.set(name, client);
    }
    try {
      await client.connect();
    } catch (err) {
      this.clients.delete(name);
      throw err;
    }
    return client;
  }

  private async ensureSession(name: string, sessionKey: string, system: string): Promise<HarnessSession> {
    const key = `${name}:${sessionKey}`;
    const cached = this.sessions.get(key);
    if (cached) return cached;
    const client = await this.clientFor(name);
    const { sessionId } = await client.sessionNew(system);
    const session: HarnessSession = { client, sessionId };
    this.sessions.set(key, session);
    return session;
  }

  async *prompt(name: string, sessionKey: string, system: string, user: string): AsyncGenerator<string> {
    const session = await this.ensureSession(name, sessionKey, system);
    const queue = new AsyncQueue<string>();
    let done = false;
    let error: Error | undefined;
    let expectedMessageId: string | undefined;

    const unsubscribe = session.client.onUpdate((update) => {
      const params = update.params;
      if (!params) return;
      if (expectedMessageId !== undefined && params.messageId !== undefined && params.messageId !== expectedMessageId) return;
      if (update.method === "session/update_complete" || params.type === "session/update_complete") {
        done = true;
        queue.push("");
        return;
      }
      const item = params.item;
      if (!item) return;
      if (item.type === "agent_message") {
        const delta =
          typeof item.text === "string"
            ? item.text
            : (item.content ?? []).map((c) => c.text ?? "").join("");
        if (delta) queue.push(delta);
      }
      if (item.type === "tool_use") {
        queue.push(`\n[harness:${String(item.tool?.name ?? "tool")}] `);
      }
    });

    const watchdog = setTimeout(() => {
      error = new Error(`ACP harness timed out after 15 minutes: ${name}`);
      done = true;
      queue.push("");
    }, 15 * 60 * 1000);
    const unref = (watchdog as { unref?: () => void }).unref;
    if (unref) unref.call(watchdog);

    try {
      const { messageId } = await session.client.prompt(session.sessionId, user);
      expectedMessageId = messageId;
      for (;;) {
        const delta = await queue.next();
        if (error) throw error;
        if (delta) yield delta;
        if (done) break;
      }
    } finally {
      clearTimeout(watchdog);
      unsubscribe();
    }
  }

  async close(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (!client) return;
    this.clients.delete(name);
    for (const [key, session] of this.sessions) {
      if (session.client === client) this.sessions.delete(key);
    }
    await client.close().catch(() => undefined);
  }

  async closeAll(): Promise<void> {
    for (const name of [...this.clients.keys()]) {
      await this.close(name);
    }
  }
}

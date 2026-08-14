import { parseAgentCard } from "./card.js";
import type { AgentCard, A2aTask, A2aSendResponse } from "./types.js";

export interface A2aClientOptions {
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class A2aClient {
  private readonly timeoutMs: number;
  private readonly fetch: typeof fetch;

  constructor(options: A2aClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.fetch = options.fetchFn ?? globalThis.fetch;
  }

  async discover(agentBaseUrl: string): Promise<AgentCard> {
    const base = agentBaseUrl.replace(/\/+$/, "");
    const candidates = [
      `${base}/.well-known/agent.json`,
      `${base}/a2a/v1/agent-card`,
      `${base}/agent-card`,
    ];
    let lastError: Error | undefined;
    for (const url of candidates) {
      try {
        const res = await this.fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (res.ok) {
          const json = await res.json();
          return parseAgentCard(json);
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
    throw new Error(`A2A Agent Card not found at ${base} (${lastError?.message ?? "HTTP request failed"}).`);
  }

  async sendMessage(
    baseUrl: string,
    messageText: string,
    timeoutMs?: number
  ): Promise<{ agentName: string; reply: string; card: AgentCard }> {
    const card = await this.discover(baseUrl);
    const timeout = timeoutMs ?? this.timeoutMs;
    const base = baseUrl.replace(/\/+$/, "");
    const jsonrpcEndpoint = card.endpoints?.jsonrpcUrl ?? `${card.url ?? base}/jsonrpc`;

    const response = await this.fetch(jsonrpcEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `a2a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ kind: "text", text: messageText }],
          },
        },
      }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`A2A message/send failed (HTTP ${response.status}): ${text.slice(0, 300)}`);
    }

    const json = (await response.json()) as {
      result?: {
        message?: { parts?: Array<{ kind?: string; text?: string }> };
        parts?: Array<{ kind?: string; text?: string }>;
        status?: string;
        error?: { message?: string };
      };
      error?: { message?: string };
    };

    if (json.error) throw new Error(`A2A error: ${json.error.message ?? "unknown"}`);
    const result = json.result;
    if (!result) throw new Error("A2A message/send: empty result");
    if (result.error) throw new Error(`A2A agent error: ${result.error.message ?? "unknown"}`);

    const parts = result.message?.parts ?? result.parts ?? [];
    const reply = parts
      .filter((part) => (part.kind === "text" || !part.kind) && part.text)
      .map((part) => part.text)
      .join("\n");

    return { agentName: card.name ?? "remote-agent", reply: reply.slice(0, 8000), card };
  }

  async createTask(
    baseUrl: string,
    input: string,
    options: { agentId?: string; sessionId?: string } = {}
  ): Promise<A2aTask> {
    const card = await this.discover(baseUrl);
    const base = baseUrl.replace(/\/+$/, "");
    const endpoint = card.endpoints?.tasksUrl ?? `${base}/a2a/v1/tasks`;

    const res = await this.fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: options.agentId,
        input,
        sessionId: options.sessionId,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new Error(`A2A createTask failed (HTTP ${res.status})`);
    }

    return (await res.json()) as A2aTask;
  }

  async getTaskStatus(baseUrl: string, taskId: string): Promise<A2aTask> {
    const base = baseUrl.replace(/\/+$/, "");
    const endpoint = `${base}/a2a/v1/tasks/${taskId}`;

    const res = await this.fetch(endpoint, {
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new Error(`A2A getTaskStatus failed (HTTP ${res.status})`);
    }

    return (await res.json()) as A2aTask;
  }
}

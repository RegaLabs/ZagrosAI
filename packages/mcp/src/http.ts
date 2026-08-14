import type { McpCallResult, McpClient, McpToolInfo } from "./types.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

export interface McpHttpOptions {
  url: string;
  headers?: Record<string, string>;
  token?: string;
  tokenRefresher?: () => Promise<string | undefined>;
  timeoutMs?: number;
}

export class McpHttpClient implements McpClient {
  private sessionId: string | undefined;
  private connected = false;
  private nextId = 1;
  private token: string | undefined;
  private readonly timeoutMs: number;

  constructor(private readonly options: McpHttpOptions) {
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    const result = await this.doRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "zagros", version: "1.0.0" },
    });
    if (typeof result !== "object" || result === null) {
      throw new Error("MCP initialize failed: invalid result");
    }
    const record = result as Record<string, unknown>;
    if (typeof record.protocolVersion !== "string") {
      throw new Error("MCP initialize failed: missing protocolVersion");
    }
    if (typeof record.capabilities !== "object" || record.capabilities === null) {
      throw new Error("MCP initialize failed: missing capabilities");
    }
    if (typeof record.serverInfo !== "object" || record.serverInfo === null) {
      throw new Error("MCP initialize failed: missing serverInfo");
    }
    this.connected = true;
    this.notify("notifications/initialized");
  }

  async listTools(): Promise<McpToolInfo[]> {
    if (!this.connected) await this.connect();
    const result = await this.request("tools/list", {});
    if (typeof result !== "object" || result === null) {
      throw new Error("MCP tools/list: invalid response");
    }
    const tools = (result as Record<string, unknown>).tools;
    if (!Array.isArray(tools)) {
      throw new Error("MCP tools/list: missing tools array");
    }
    return tools.map((t) => {
      const tool = t as Record<string, unknown>;
      return {
        name: typeof tool.name === "string" ? tool.name : "",
        description: typeof tool.description === "string" ? tool.description : "",
        inputSchema:
          typeof tool.inputSchema === "object" && tool.inputSchema !== null
            ? (tool.inputSchema as Record<string, unknown>)
            : {},
      };
    });
  }

  async callTool(name: string, args: unknown): Promise<McpCallResult> {
    if (!this.connected) await this.connect();
    const result = await this.request("tools/call", { name, arguments: args });
    if (typeof result !== "object" || result === null) {
      throw new Error("MCP tools/call: invalid response");
    }
    const record = result as Record<string, unknown>;
    const content = Array.isArray(record.content) ? record.content : [];
    const parts: string[] = [];
    for (const item of content) {
      if (typeof item !== "object" || item === null) continue;
      const entry = item as Record<string, unknown>;
      if (entry.type === "text" && typeof entry.text === "string") {
        parts.push(entry.text);
      } else {
        parts.push(JSON.stringify(item));
      }
    }
    const isError = record.isError === true;
    return { ok: !isError, text: parts.join("\n"), isError };
  }

  async close(): Promise<void> {
    this.connected = false;
    this.sessionId = undefined;
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    try {
      return await this.doRequest(method, params);
    } catch (err) {
      // If request failed because session expired (e.g. 404 or connection dropped), try reconnecting once
      const msg = err instanceof Error ? err.message : String(err);
      if (this.sessionId !== undefined && (msg.includes("404") || msg.includes("session"))) {
        this.sessionId = undefined;
        this.connected = false;
        await this.connect();
        return await this.doRequest(method, params);
      }
      throw err;
    }
  }

  private async doRequest(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const payload: Record<string, unknown> = { jsonrpc: "2.0", id, method, params: params ?? {} };
    let tokenRefreshAttempts = 0;

    for (;;) {
      let res: Response;
      try {
        res = await fetch(this.options.url, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        throw new Error(`MCP HTTP request failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (res.status === 404) {
        throw new Error(
          `MCP server returned 404 for ${this.options.url}. The URL must point to the MCP streamable HTTP endpoint.`
        );
      }

      if ((res.status === 401 || res.status === 403) && this.options.tokenRefresher) {
        if (tokenRefreshAttempts === 0) {
          tokenRefreshAttempts += 1;
          const fresh = await this.options.tokenRefresher();
          if (fresh) {
            this.token = fresh;
            continue;
          }
        }
        throw new Error("MCP server rejected token");
      }

      if (!res.ok) {
        throw new Error(`MCP server returned HTTP ${res.status} ${res.statusText}`);
      }

      const session = res.headers.get("mcp-session-id");
      if (session !== null) {
        this.sessionId = session;
      }

      const contentType = res.headers.get("content-type") ?? "";
      const body = await res.text();
      if (contentType.includes("text/event-stream")) {
        return this.parseSse(body, id);
      }

      if (!body.trim()) {
        throw new Error("MCP server returned an empty response");
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new Error("MCP server returned invalid JSON");
      }

      if (typeof parsed !== "object" || parsed === null) {
        throw new Error("MCP server returned an invalid response");
      }

      const record = parsed as Record<string, unknown>;
      if (record.error !== undefined && record.error !== null) {
        throw new Error(this.errorMessage(record.error));
      }
      return record.result;
    }
  }

  private parseSse(text: string, expectedId?: number): unknown {
    let lastError: string | undefined;
    const blocks = text.split(/\r?\n\r?\n/);
    for (const block of blocks) {
      const lines = block.split(/\r?\n/);
      let event = "";
      const dataLines: string[] = [];
      for (const raw of lines) {
        if (raw.startsWith(":")) continue;
        if (raw.startsWith("event:")) {
          event = raw.slice(6).trim();
        } else if (raw.startsWith("data:")) {
          dataLines.push(raw.slice(5).trimStart());
        }
      }
      if (dataLines.length === 0) continue;
      if (event === "error") {
        lastError = dataLines.join("\n");
        continue;
      }
      const data = dataLines.join("\n");
      if (data === "[DONE]") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      if (typeof parsed !== "object" || parsed === null) continue;
      const record = parsed as Record<string, unknown>;
      const recordId = typeof record.id === "number" ? record.id : Number(record.id);
      if (!isNaN(recordId)) {
        if (expectedId !== undefined && recordId !== expectedId) continue;
        if (record.error !== undefined && record.error !== null) {
          throw new Error(this.errorMessage(record.error));
        }
        return record.result;
      }
    }
    if (lastError !== undefined) {
      throw new Error(`MCP SSE error event: ${lastError}`);
    }
    throw new Error("MCP server returned no valid response in SSE stream");
  }

  private notify(method: string): void {
    void fetch(this.options.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: "2.0", method }),
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch(() => {});
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      ...this.options.headers,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (this.sessionId !== undefined) {
      headers["mcp-session-id"] = this.sessionId;
    }
    if (this.token !== undefined) {
      headers.authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  private errorMessage(error: unknown): string {
    if (typeof error === "string") return error;
    if (typeof error === "object" && error !== null) {
      const record = error as Record<string, unknown>;
      const code = typeof record.code === "number" ? `[code ${record.code}] ` : "";
      const msg = typeof record.message === "string" ? record.message : JSON.stringify(error);
      const data = record.data !== undefined ? ` (data: ${JSON.stringify(record.data)})` : "";
      return `${code}${msg}${data}`;
    }
    return JSON.stringify(error);
  }
}

export interface McpOAuthDiscovery {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  resourceServer: string;
}

export async function discoverMcpOAuth(url: string, timeoutMs = 15_000): Promise<McpOAuthDiscovery> {
  const origin = new URL(url).origin;
  let discovery: unknown;
  try {
    const res = await fetch(
      `${origin}/.well-known/oauth-protected-resource?resource=${encodeURIComponent(url)}`,
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      }
    );
    if (res.ok) {
      discovery = await res.json().catch(() => undefined);
    }
  } catch {
    discovery = undefined;
  }
  let authorizationServer: string | undefined;
  if (typeof discovery === "object" && discovery !== null) {
    const record = discovery as Record<string, unknown>;
    const servers = record["authorization_servers"];
    if (Array.isArray(servers) && servers.length > 0 && typeof servers[0] === "string") {
      authorizationServer = servers[0];
    } else if (
      typeof record["authorization_endpoint"] === "string" &&
      typeof record["token_endpoint"] === "string"
    ) {
      return {
        authorizationEndpoint: record["authorization_endpoint"],
        tokenEndpoint: record["token_endpoint"],
        resourceServer: url,
      };
    }
  }
  if (!authorizationServer) {
    throw new Error(`MCP OAuth discovery failed: no authorization server found for ${url}`);
  }
  const metadataUrl = authorizationServer.endsWith("/.well-known/oauth-authorization-server")
    ? authorizationServer
    : `${authorizationServer}/.well-known/oauth-authorization-server`;
  let metadata: unknown;
  try {
    const res = await fetch(metadataUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`authorization server metadata request failed with HTTP ${res.status}`);
    }
    metadata = await res.json();
  } catch (err) {
    throw new Error(
      `MCP OAuth discovery failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (typeof metadata !== "object" || metadata === null) {
    throw new Error("MCP OAuth discovery failed: invalid authorization server metadata");
  }
  const record = metadata as Record<string, unknown>;
  if (typeof record["authorization_endpoint"] !== "string" || typeof record["token_endpoint"] !== "string") {
    throw new Error(
      "MCP OAuth discovery failed: metadata missing authorization_endpoint or token_endpoint"
    );
  }
  return {
    authorizationEndpoint: record["authorization_endpoint"],
    tokenEndpoint: record["token_endpoint"],
    resourceServer: url,
  };
}

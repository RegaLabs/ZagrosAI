import { newId, now } from "@zagros/domain";
import type { CredentialStore } from "@zagros/credentials";
import type { Repos } from "@zagros/runtime";
import { ToolRegistry } from "@zagros/tools";
import { McpHttpClient, discoverMcpOAuth } from "./http.js";
import { createMcpToolDefinition } from "./tool-adapter.js";
import type { McpClient, McpServerConfigLike } from "./types.js";

function b64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function generatePkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = b64Url(verifierBytes);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64Url(new Uint8Array(digest)) };
}

export interface McpSyncResult {
  added: string[];
  removed: string[];
  failed: Array<{ id: string; error: string }>;
}

export interface McpServerStatus {
  id: string;
  name: string;
  connected: boolean;
  tools: string[];
}

export interface McpOAuthOptions {
  store: CredentialStore;
  repos: Repos;
  callbackBaseUrl: () => string;
}

export interface McpOAuthStatus {
  status: "connected" | "awaiting" | "error";
  authorizationUrl?: string;
  error?: string;
}

interface StoredMcpToken {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  refreshedAt?: string;
}

const PENDING_TTL_MS = 600_000;

export class McpManager {
  private readonly clients = new Map<string, McpClient>();
  private readonly toolIds = new Set<string>();
  private readonly names = new Map<string, string>();
  private readonly configs = new Map<string, McpServerConfigLike>();
  private readonly oauthState = new Map<string, McpOAuthStatus>();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly oauthOptions?: McpOAuthOptions
  ) {}

  async sync(configs: McpServerConfigLike[], options?: { stdioSupported?: boolean }): Promise<McpSyncResult> {
    const added: string[] = [];
    const removed: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    const wanted = new Set(configs.map((c) => c.id));

    for (const id of [...this.clients.keys()]) {
      if (!wanted.has(id)) {
        await this.removeServer(id);
        removed.push(id);
      }
    }

    for (const config of configs) {
      this.configs.set(config.id, config);
      if (config.oauth) {
        await this.syncOAuthServer(config, added);
        continue;
      }
      if (this.clients.has(config.id)) continue;
      let client: McpClient;
      try {
        if (config.transport === "http") {
          client = new McpHttpClient({
            url: config.url ?? "",
            timeoutMs: config.timeoutMs,
          });
        } else {
          if (options?.stdioSupported === false) {
            failed.push({ id: config.id, error: "stdio MCP servers are not supported on this runtime; use an HTTP MCP server or run it on an Zagros Runner." });
            continue;
          }
          const { McpStdioClient } = await import("./stdio.js");
          client = new McpStdioClient({
            command: config.command ?? "",
            args: config.args,
            cwd: config.cwd,
            env: config.env,
            timeoutMs: config.timeoutMs,
          });
        }
        await client.connect();
        const tools = await client.listTools();
        this.clients.set(config.id, client);
        this.names.set(config.id, config.name);
        for (const info of tools) {
          const toolId = `${config.id}__${info.name}`;
          this.registry.register({ ...createMcpToolDefinition(client, info), id: toolId });
          this.toolIds.add(toolId);
        }
        added.push(config.id);
      } catch (err) {
        failed.push({ id: config.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { added, removed, failed };
  }

  async closeAll(): Promise<void> {
    for (const id of [...this.clients.keys()]) {
      await this.removeServer(id);
    }
    for (const id of [...this.oauthState.keys()]) {
      if (!this.clients.has(id)) {
        this.oauthState.set(id, { status: "error", error: "server removed" });
        this.configs.delete(id);
      }
    }
  }

  status(): McpServerStatus[] {
    const out: McpServerStatus[] = [];
    for (const [id, client] of this.clients) {
      const tools = [...this.toolIds].filter((t) => t.startsWith(`${id}__`));
      out.push({ id, name: this.names.get(id) ?? id, connected: true, tools });
    }
    return out;
  }

  oauthStatus(serverId?: string): McpOAuthStatus | undefined {
    if (!serverId) return undefined;
    return this.oauthState.get(serverId);
  }

  async beginOAuth(serverId: string): Promise<{ authorizationUrl: string }> {
    const config = this.configs.get(serverId);
    if (!config) throw new Error("MCP server not found");
    const existing = this.oauthState.get(serverId);
    if (existing && existing.status === "awaiting" && existing.authorizationUrl) {
      return { authorizationUrl: existing.authorizationUrl };
    }
    const { authorizationUrl } = await this.createPendingOAuth(config);
    this.oauthState.set(serverId, { status: "awaiting", authorizationUrl });
    return { authorizationUrl };
  }

  async completeOAuth(state: string, code: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.oauthOptions) return { ok: false, error: "MCP OAuth is not configured on this runtime" };
    const pending = await this.oauthOptions.repos.getPendingAuth(state);
    if (!pending) return { ok: false, error: "OAuth state not found or expired" };
    await this.oauthOptions.repos.deletePendingAuth(state);
    const serverId = pending.provider.replace(/^mcp:/, "");
    const config = this.configs.get(serverId);
    if (!config) return { ok: false, error: `MCP server not found: ${serverId}` };
    const endpoints = await discoverMcpOAuth(config.url ?? "");
    const verifier = await this.oauthOptions.store.decrypt<string>(pending.verifierEncrypted);
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: pending.redirectUri,
      client_id: config.oauth?.clientId ?? "zagros",
      code_verifier: verifier,
    });
    const res = await fetch(endpoints.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: body.toString(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return { ok: false, error: `token endpoint returned HTTP ${res.status}` };
    const parsed = (await res.json().catch(() => undefined)) as Record<string, unknown> | undefined;
    const accessToken = parsed && typeof parsed["access_token"] === "string" ? parsed["access_token"] : undefined;
    if (!accessToken) return { ok: false, error: "token endpoint returned no access_token" };
    const refreshToken = parsed && typeof parsed["refresh_token"] === "string" ? parsed["refresh_token"] : undefined;
    const expiresIn = parsed && typeof parsed["expires_in"] === "number" ? parsed["expires_in"] : undefined;
    const scope = parsed && typeof parsed["scope"] === "string" ? parsed["scope"] : undefined;
    await this.oauthOptions.repos.saveCredential({
      id: newId("cred"),
      provider: "mcp:" + serverId,
      account: serverId,
      scopes: scope ? scope.split(" ") : config.oauth?.scopes ?? [],
      tokenJson: await this.oauthOptions.store.encrypt({
        accessToken,
        refreshToken,
        expiresIn,
        refreshedAt: now(),
      }),
      createdAt: now(),
      updatedAt: now(),
    });
    try {
      await this.connectOAuthServer(config);
      this.oauthState.set(serverId, { status: "connected" });
    } catch (err) {
      this.oauthState.set(serverId, { status: "error", error: err instanceof Error ? err.message : String(err) });
    }
    await this.oauthOptions.repos.appendAudit({
      id: newId("audit"),
      type: "mcp.oauth.connected",
      detail: { serverId },
      createdAt: now(),
    });
    return { ok: true };
  }

  private async syncOAuthServer(config: McpServerConfigLike, added: string[]): Promise<void> {
    if (this.clients.has(config.id)) {
      this.oauthState.set(config.id, { status: "connected" });
      return;
    }
    if (!this.oauthOptions) {
      this.oauthState.set(config.id, { status: "error", error: "MCP OAuth is not configured on this runtime" });
      return;
    }
    try {
      const credential = (await this.oauthOptions.repos.listCredentials()).find(
        (c) => c.provider === "mcp:" + config.id
      );
      if (!credential) {
        const { authorizationUrl } = await this.createPendingOAuth(config);
        this.oauthState.set(config.id, { status: "awaiting", authorizationUrl });
        return;
      }
      await this.connectOAuthServer(config);
      added.push(config.id);
      this.oauthState.set(config.id, { status: "connected" });
    } catch (err) {
      this.oauthState.set(config.id, { status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async connectOAuthServer(config: McpServerConfigLike): Promise<void> {
    if (!this.oauthOptions) throw new Error("MCP OAuth is not configured on this runtime");
    const credential = (await this.oauthOptions.repos.listCredentials()).find(
      (c) => c.provider === "mcp:" + config.id
    );
    if (!credential) throw new Error("No stored credential for MCP server");
    const stored = await this.oauthOptions.store.decrypt<StoredMcpToken>(credential.tokenJson);
    const client = new McpHttpClient({
      url: config.url ?? "",
      token: stored.accessToken,
      tokenRefresher: () => this.refreshTokenFor(config.id),
      timeoutMs: config.timeoutMs,
    });
    await client.connect();
    const tools = await client.listTools();
    this.clients.set(config.id, client);
    this.names.set(config.id, config.name);
    for (const info of tools) {
      const toolId = `${config.id}__${info.name}`;
      this.registry.register({ ...createMcpToolDefinition(client, info), id: toolId });
      this.toolIds.add(toolId);
    }
  }

  private async createPendingOAuth(config: McpServerConfigLike): Promise<{ authorizationUrl: string }> {
    if (!this.oauthOptions) throw new Error("MCP OAuth is not configured on this runtime");
    const endpoints = await discoverMcpOAuth(config.url ?? "");
    const { verifier, challenge } = await generatePkcePair();
    const base = this.oauthOptions.callbackBaseUrl();
    if (!base) throw new Error("publicBaseUrl not configured");
    const callback = `${base}/api/mcp/oauth/callback`;
    const state = crypto.randomUUID();
    await this.oauthOptions.repos.savePendingAuth({
      state,
      provider: "mcp:" + config.id,
      redirectUri: callback,
      verifierEncrypted: await this.oauthOptions.store.encrypt(verifier),
      expiresAt: new Date(Date.now() + PENDING_TTL_MS).toISOString(),
      createdAt: now(),
    });
    const scopes = config.oauth?.scopes;
    const scopeParam = scopes && scopes.length > 0 ? `&scope=${encodeURIComponent(scopes.join(" "))}` : "";
    const authorizationUrl =
      `${endpoints.authorizationEndpoint}?response_type=code` +
      `&client_id=${encodeURIComponent(config.oauth?.clientId ?? "zagros")}` +
      `&redirect_uri=${encodeURIComponent(callback)}` +
      `&code_challenge=${challenge}&code_challenge_method=S256&state=${state}` +
      scopeParam;
    return { authorizationUrl };
  }

  private async refreshTokenFor(serverId: string): Promise<string | undefined> {
    if (!this.oauthOptions) return undefined;
    const config = this.configs.get(serverId);
    if (!config) return undefined;
    try {
      const credential = (await this.oauthOptions.repos.listCredentials()).find(
        (c) => c.provider === "mcp:" + serverId
      );
      if (!credential) return undefined;
      const stored = await this.oauthOptions.store.decrypt<StoredMcpToken>(credential.tokenJson);
      if (!stored.refreshToken) return undefined;
      const endpoints = await discoverMcpOAuth(config.url ?? "");
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: stored.refreshToken,
        client_id: config.oauth?.clientId ?? "zagros",
      });
      const res = await fetch(endpoints.tokenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: body.toString(),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return undefined;
      const parsed = (await res.json().catch(() => undefined)) as Record<string, unknown> | undefined;
      const accessToken = parsed && typeof parsed["access_token"] === "string" ? parsed["access_token"] : undefined;
      if (!accessToken) return undefined;
      const refreshToken =
        parsed && typeof parsed["refresh_token"] === "string" ? parsed["refresh_token"] : stored.refreshToken;
      const expiresIn = parsed && typeof parsed["expires_in"] === "number" ? parsed["expires_in"] : stored.expiresIn;
      const updated: StoredMcpToken = { accessToken, refreshToken, expiresIn, refreshedAt: now() };
      credential.tokenJson = await this.oauthOptions.store.encrypt(updated);
      credential.updatedAt = now();
      await this.oauthOptions.repos.saveCredential(credential);
      return accessToken;
    } catch {
      return undefined;
    }
  }

  private async removeServer(id: string): Promise<void> {
    for (const toolId of [...this.toolIds]) {
      if (toolId.startsWith(`${id}__`)) {
        this.registry.remove(toolId);
        this.toolIds.delete(toolId);
      }
    }
    const client = this.clients.get(id);
    this.clients.delete(id);
    this.names.delete(id);
    this.oauthState.set(id, { status: "error", error: "server removed" });
    this.configs.delete(id);
    if (client) {
      try {
        await client.close();
      } catch {
      }
    }
  }
}

import { newId, now, type Credential, type OAuthPending } from "@zagros/domain";
import type { CredentialStore } from "@zagros/credentials";
import type { Repos } from "@zagros/runtime";
import type { LocalEventBus } from "../events.js";

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
  tokenType?: string;
}

export interface OAuthProvider {
  readonly id: string;
  readonly label: string;
  readonly scopes: string[];
  buildAuthorizeUrl(opts: { redirectUri: string; state: string; codeChallenge: string }): string;
  exchangeCode(opts: { code: string; redirectUri: string; codeVerifier: string }): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
  revoke?(tokenSet: TokenSet): Promise<void>;
  userInfo(accessToken: string): Promise<Record<string, unknown>>;
}

export interface CredentialView {
  id: string;
  provider: string;
  providerLabel: string;
  account: string;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
}

interface StoredTokenSet extends TokenSet {
  refreshedAt: string;
}

const PENDING_TTL_MS = 10 * 60 * 1000;
const REFRESH_SKEW_MS = 60_000;

function b64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function generatePkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = b64Url(verifierBytes);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64Url(new Uint8Array(digest)) };
}

export class OAuthBroker {
  private readonly providers = new Map<string, OAuthProvider>();

  constructor(
    private readonly repos: Repos,
    private readonly store: CredentialStore
  ) {}

  register(provider: OAuthProvider): void {
    this.providers.set(provider.id, provider);
  }

  hasProvider(id: string): boolean {
    return this.providers.has(id);
  }

  listProviders(): Array<{ id: string; label: string; scopes: string[] }> {
    return [...this.providers.values()].map((p) => ({ id: p.id, label: p.label, scopes: p.scopes }));
  }

  async beginAuthorization(providerId: string, redirectUri: string): Promise<string> {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Unknown OAuth provider: ${providerId}`);
    const state = newId("oauth");
    const { verifier, challenge } = await generatePkcePair();
    const pending: OAuthPending = {
      state,
      provider: providerId,
      redirectUri,
      verifierEncrypted: await this.store.encrypt(verifier),
      expiresAt: new Date(Date.now() + PENDING_TTL_MS).toISOString(),
      createdAt: now(),
    };
    await this.repos.savePendingAuth(pending);
    return provider.buildAuthorizeUrl({ redirectUri, state, codeChallenge: challenge });
  }

  async completeAuthorization(providerId: string, code: string, state: string, redirectUri: string): Promise<CredentialView> {
    const pending = await this.repos.getPendingAuth(state);
    if (!pending) throw new Error("OAuth state not found or expired");
    if (pending.provider !== providerId) throw new Error("OAuth provider mismatch");
    await this.repos.deletePendingAuth(state);
    if (Date.parse(pending.expiresAt) < Date.now()) throw new Error("OAuth state expired");
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Unknown OAuth provider: ${providerId}`);
    const verifier = await this.store.decrypt<string>(pending.verifierEncrypted);
    const tokenSet = await provider.exchangeCode({ code, redirectUri, codeVerifier: verifier });
    let account = providerId;
    try {
      const info = await provider.userInfo(tokenSet.accessToken);
      const candidate =
        info.email ?? info.login ?? info.name ?? info.id ?? info.sub ?? info.preferred_username;
      if (typeof candidate === "string" && candidate) account = `${providerId}:${candidate}`;
    } catch {
      account = `${providerId}:unknown`;
    }
    const stored: StoredTokenSet = { ...tokenSet, refreshedAt: now() };
    const credential: Credential = {
      id: newId("cred"),
      provider: providerId,
      account,
      scopes: provider.scopes,
      tokenJson: await this.store.encrypt(stored),
      createdAt: now(),
      updatedAt: now(),
    };
    await this.repos.saveCredential(credential);
    await this.repos.appendAudit({ id: newId("audit"), type: "connector.connected", detail: { provider: providerId, account }, createdAt: now() });
    return this.view(credential, provider);
  }

  async list(): Promise<CredentialView[]> {
    const credentials = await this.repos.listCredentials();
    const views: CredentialView[] = [];
    for (const credential of credentials) {
      const provider = this.providers.get(credential.provider);
      views.push(this.view(credential, provider));
    }
    return views;
  }

  async revoke(id: string): Promise<boolean> {
    const credential = await this.repos.getCredential(id);
    if (!credential) return false;
    const provider = this.providers.get(credential.provider);
    if (provider?.revoke) {
      try {
        const tokenSet = await this.store.decrypt<StoredTokenSet>(credential.tokenJson);
        await provider.revoke(tokenSet);
      } catch {
        // revocation is best-effort
      }
    }
    await this.repos.deleteCredential(id);
    await this.repos.appendAudit({ id: newId("audit"), type: "connector.removed", detail: { provider: credential.provider, account: credential.account }, createdAt: now() });
    return true;
  }

  async accessToken(id: string): Promise<string> {
    const tokenSet = await this.tokenSet(id);
    return tokenSet.accessToken;
  }

  async tokenSet(id: string): Promise<StoredTokenSet> {
    const credential = await this.repos.getCredential(id);
    if (!credential) throw new Error(`Connector not found: ${id}`);
    const tokenSet = await this.store.decrypt<StoredTokenSet>(credential.tokenJson);
    if (
      tokenSet.refreshToken &&
      tokenSet.expiresIn &&
      Date.parse(tokenSet.refreshedAt) + tokenSet.expiresIn * 1000 - REFRESH_SKEW_MS < Date.now()
    ) {
      const provider = this.providers.get(credential.provider);
      if (!provider) throw new Error(`Unknown provider for connector: ${credential.provider}`);
      const refreshed = await provider.refresh(tokenSet.refreshToken);
      const updated: StoredTokenSet = {
        ...tokenSet,
        ...refreshed,
        refreshToken: refreshed.refreshToken ?? tokenSet.refreshToken,
        refreshedAt: now(),
      };
      credential.tokenJson = await this.store.encrypt(updated);
      credential.updatedAt = now();
      await this.repos.saveCredential(credential);
      return updated;
    }
    return tokenSet;
  }

  private view(credential: Credential, provider: OAuthProvider | undefined): CredentialView {
    return {
      id: credential.id,
      provider: credential.provider,
      providerLabel: provider?.label ?? credential.provider,
      account: credential.account,
      scopes: credential.scopes,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
    };
  }
}

export type { StoredTokenSet };

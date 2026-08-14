import type { OAuthProvider, TokenSet } from "@zagros/kernel";
import type { OAuthAppConfig } from "./config.js";

const DEFAULT_TIMEOUT_MS = 30_000;

function enc(value: string): string {
  return encodeURIComponent(value);
}

export class NotionProvider implements OAuthProvider {
  readonly id = "notion";
  readonly label = "Notion";
  readonly scopes = [];

  constructor(private readonly config: OAuthAppConfig = {}) {}

  buildAuthorizeUrl(opts: { redirectUri: string; state: string; codeChallenge: string }): string {
    if (!this.config.clientId) {
      throw new Error("Notion OAuth is not configured (missing client id)");
    }
    return (
      `${this.config.authorizeUrl ?? "https://api.notion.com/v1/oauth/authorize"}?` +
      `client_id=${enc(this.config.clientId)}` +
      `&response_type=code` +
      `&owner=user` +
      `&redirect_uri=${enc(opts.redirectUri)}` +
      `&state=${enc(opts.state)}`
    );
  }

  async exchangeCode(opts: { code: string; redirectUri: string; codeVerifier: string }): Promise<TokenSet> {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new Error("Notion OAuth is not configured (missing client credentials)");
    }
    const basicAuth = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");

    const res = await fetch(this.config.tokenUrl ?? "https://api.notion.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Basic ${basicAuth}`,
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: opts.code,
        redirect_uri: opts.redirectUri,
      }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok || data.error) {
      throw new Error(`Notion OAuth error: ${data.error ?? res.statusText}`);
    }

    const accessToken = (data.access_token as string) ?? "";
    if (!accessToken) throw new Error("Notion OAuth exchange returned no access_token");

    return {
      accessToken,
      tokenType: "Bearer",
    };
  }

  async refresh(refreshToken: string): Promise<TokenSet> {
    return {
      accessToken: refreshToken,
      tokenType: "Bearer",
    };
  }

  async revoke(_tokenSet: TokenSet): Promise<void> {
    // Notion tokens can be disconnected via user settings
  }

  async userInfo(accessToken: string): Promise<Record<string, unknown>> {
    if (!accessToken) throw new Error("Notion userinfo failed: missing access token");
    const res = await fetch("https://api.notion.com/v1/users/me", {
      headers: {
        authorization: `Bearer ${accessToken}`,
        "Notion-Version": "2022-06-28",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Notion userinfo failed with HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }
}

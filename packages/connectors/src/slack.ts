import type { OAuthProvider, TokenSet } from "@zagros/kernel";
import type { OAuthAppConfig } from "./config.js";

const DEFAULT_TIMEOUT_MS = 30_000;

function enc(value: string): string {
  return encodeURIComponent(value);
}

export class SlackProvider implements OAuthProvider {
  readonly id = "slack";
  readonly label = "Slack";
  readonly scopes = ["channels:read", "chat:write", "users:read"];

  constructor(private readonly config: OAuthAppConfig = {}) {}

  buildAuthorizeUrl(opts: { redirectUri: string; state: string; codeChallenge: string }): string {
    if (!this.config.clientId) {
      throw new Error("Slack OAuth is not configured (missing client id)");
    }
    return (
      `${this.config.authorizeUrl ?? "https://slack.com/oauth/v2/authorize"}?` +
      `client_id=${enc(this.config.clientId)}` +
      `&user_scope=${enc(this.scopes.join(","))}` +
      `&redirect_uri=${enc(opts.redirectUri)}` +
      `&state=${enc(opts.state)}`
    );
  }

  async exchangeCode(opts: { code: string; redirectUri: string; codeVerifier: string }): Promise<TokenSet> {
    if (!this.config.clientId) throw new Error("Slack OAuth is not configured (missing client id)");
    if (!this.config.clientSecret) throw new Error("Slack OAuth is not configured (missing client secret)");

    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code: opts.code,
      redirect_uri: opts.redirectUri,
    });

    const res = await fetch(this.config.tokenUrl ?? "https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    const data = (await res.json()) as Record<string, unknown>;
    if (!data.ok) {
      throw new Error(`Slack OAuth error: ${data.error ?? "unknown error"}`);
    }

    const authedUser = data.authed_user as Record<string, unknown> | undefined;
    const accessToken = (authedUser?.access_token as string) ?? (data.access_token as string) ?? "";
    if (!accessToken) throw new Error("Slack OAuth exchange returned no access_token");

    return {
      accessToken,
      refreshToken: (authedUser?.refresh_token as string) ?? (data.refresh_token as string) ?? undefined,
      expiresIn: (authedUser?.expires_in as number) ?? (data.expires_in as number) ?? undefined,
      scope: (authedUser?.scope as string) ?? (data.scope as string) ?? this.scopes.join(","),
      tokenType: "Bearer",
    };
  }

  async refresh(refreshToken: string): Promise<TokenSet> {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new Error("Slack OAuth is not configured (missing client credentials)");
    }
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    const res = await fetch(this.config.tokenUrl ?? "https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    const data = (await res.json()) as Record<string, unknown>;
    if (!data.ok) {
      throw new Error(`Slack OAuth refresh error: ${data.error ?? "unknown error"}`);
    }

    const accessToken = (data.access_token as string) ?? "";
    return {
      accessToken,
      refreshToken: (data.refresh_token as string) ?? refreshToken,
      expiresIn: data.expires_in as number | undefined,
      tokenType: "Bearer",
    };
  }

  async revoke(tokenSet: TokenSet): Promise<void> {
    if (!tokenSet.accessToken) return;
    try {
      await fetch("https://slack.com/api/auth.revoke", {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokenSet.accessToken}`,
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Best-effort revocation
    }
  }

  async userInfo(accessToken: string): Promise<Record<string, unknown>> {
    if (!accessToken) throw new Error("Slack userinfo failed: missing access token");
    const res = await fetch("https://slack.com/api/auth.test", {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Slack userinfo failed with HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }
}

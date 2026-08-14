import type { OAuthProvider, TokenSet } from "@zagros/kernel";
import type { OAuthAppConfig } from "./config.js";

const DEFAULT_TIMEOUT_MS = 30_000;

function enc(value: string): string {
  return encodeURIComponent(value);
}

async function formPost(url: string, body: URLSearchParams): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`Google OAuth network error: ${err instanceof Error ? err.message : String(err)}`);
  }

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }

  if (typeof parsed === "object" && parsed !== null) {
    const record = parsed as Record<string, unknown>;
    if (typeof record["error"] === "string") {
      const desc = typeof record["error_description"] === "string" ? `: ${record["error_description"]}` : "";
      throw new Error(`Google OAuth request failed (${record["error"]}${desc})`);
    }
  }

  if (!res.ok) {
    throw new Error(`Google OAuth request failed with HTTP ${res.status}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Google OAuth request failed: invalid JSON response (HTTP ${res.status})`);
  }

  return parsed as Record<string, unknown>;
}

export class GoogleProvider implements OAuthProvider {
  readonly id = "google";
  readonly label = "Google";
  readonly scopes = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/drive.readonly",
  ];

  constructor(private readonly config: OAuthAppConfig) {}

  buildAuthorizeUrl(opts: { redirectUri: string; state: string; codeChallenge: string }): string {
    if (!this.config.clientId) {
      throw new Error("Google OAuth is not configured (missing client id)");
    }
    const pkceParam = opts.codeChallenge
      ? `&code_challenge=${enc(opts.codeChallenge)}&code_challenge_method=S256`
      : "";
    return (
      `${this.config.authorizeUrl ?? "https://accounts.google.com/o/oauth2/v2/auth"}?` +
      `client_id=${enc(this.config.clientId)}` +
      `&redirect_uri=${enc(opts.redirectUri)}` +
      `&response_type=code` +
      `&scope=${enc(this.scopes.join(" "))}` +
      `&access_type=offline&prompt=consent` +
      `&state=${enc(opts.state)}` +
      pkceParam +
      `&include_granted_scopes=true`
    );
  }

  async exchangeCode(opts: { code: string; redirectUri: string; codeVerifier: string }): Promise<TokenSet> {
    if (!this.config.clientId) throw new Error("Google OAuth is not configured (missing client id)");
    if (!this.config.clientSecret) {
      throw new Error("Google OAuth is not configured (missing client secret)");
    }
    const body = new URLSearchParams({
      code: opts.code,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: opts.redirectUri,
      grant_type: "authorization_code",
      code_verifier: opts.codeVerifier,
    });
    return this.parseTokenSet(await formPost(this.config.tokenUrl ?? "https://oauth2.googleapis.com/token", body));
  }

  async refresh(refreshToken: string): Promise<TokenSet> {
    if (!this.config.clientId) throw new Error("Google OAuth is not configured (missing client id)");
    if (!this.config.clientSecret) {
      throw new Error("Google OAuth is not configured (missing client secret)");
    }
    if (!refreshToken || typeof refreshToken !== "string" || !refreshToken.trim()) {
      throw new Error("Google OAuth refresh failed: missing refresh token");
    }
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken.trim(),
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
    return this.parseTokenSet(
      await formPost(this.config.tokenUrl ?? "https://oauth2.googleapis.com/token", body),
      refreshToken
    );
  }

  async revoke(tokenSet: TokenSet): Promise<void> {
    if (!tokenSet.accessToken) return;
    try {
      await fetch(
        `https://oauth2.googleapis.com/revoke?token=${enc(tokenSet.accessToken)}`,
        {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
        }
      );
    } catch {
      // Best-effort revocation
    }
  }

  async userInfo(accessToken: string): Promise<Record<string, unknown>> {
    if (!accessToken) throw new Error("Google userinfo failed: missing access token");
    let res: Response;
    try {
      res = await fetch(
        `${this.config.apiBase ?? "https://www.googleapis.com"}/oauth2/v2/userinfo`,
        {
          headers: { authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(15_000),
        }
      );
    } catch (err) {
      throw new Error(`Google userinfo network error: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!res.ok) {
      throw new Error(`Google userinfo failed with HTTP ${res.status}`);
    }

    const parsed: unknown = await res.json().catch(() => undefined);
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("Google userinfo returned an invalid response");
    }
    return parsed as Record<string, unknown>;
  }

  private parseTokenSet(record: Record<string, unknown>, fallbackRefreshToken?: string): TokenSet {
    if (typeof record["access_token"] !== "string" || !record["access_token"]) {
      throw new Error("Google OAuth token response missing access_token");
    }
    return {
      accessToken: record["access_token"],
      refreshToken: typeof record["refresh_token"] === "string" && record["refresh_token"] ? record["refresh_token"] : fallbackRefreshToken,
      expiresIn: typeof record["expires_in"] === "number" ? record["expires_in"] : undefined,
      scope: typeof record["scope"] === "string" ? record["scope"] : undefined,
      tokenType: typeof record["token_type"] === "string" ? record["token_type"] : undefined,
    };
  }
}

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
    throw new Error(`Microsoft OAuth network error: ${err instanceof Error ? err.message : String(err)}`);
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
      throw new Error(`Microsoft OAuth request failed (${record["error"]}${desc})`);
    }
  }

  if (!res.ok) {
    throw new Error(`Microsoft OAuth request failed with HTTP ${res.status}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Microsoft OAuth request failed: invalid JSON response (HTTP ${res.status})`);
  }

  return parsed as Record<string, unknown>;
}

export class MicrosoftProvider implements OAuthProvider {
  readonly id = "microsoft";
  readonly label = "Microsoft";
  readonly scopes = ["User.Read", "offline_access", "Files.Read"];

  constructor(private readonly config: OAuthAppConfig = {}) {}

  buildAuthorizeUrl(opts: { redirectUri: string; state: string; codeChallenge: string }): string {
    if (!this.config.clientId) {
      throw new Error("Microsoft OAuth is not configured (missing client id)");
    }
    const pkceParam = opts.codeChallenge
      ? `&code_challenge=${enc(opts.codeChallenge)}&code_challenge_method=S256`
      : "";
    return (
      `${this.config.authorizeUrl ?? "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"}?` +
      `client_id=${enc(this.config.clientId)}` +
      `&redirect_uri=${enc(opts.redirectUri)}` +
      `&response_type=code` +
      `&scope=${enc(this.scopes.join(" "))}` +
      `&response_mode=query` +
      `&state=${enc(opts.state)}` +
      pkceParam
    );
  }

  async exchangeCode(opts: { code: string; redirectUri: string; codeVerifier: string }): Promise<TokenSet> {
    if (!this.config.clientId) throw new Error("Microsoft OAuth is not configured (missing client id)");
    const body = new URLSearchParams({
      code: opts.code,
      client_id: this.config.clientId,
      grant_type: "authorization_code",
      redirect_uri: opts.redirectUri,
    });
    if (this.config.clientSecret) body.set("client_secret", this.config.clientSecret);
    if (opts.codeVerifier) body.set("code_verifier", opts.codeVerifier);

    return this.parseTokenSet(
      await formPost(this.config.tokenUrl ?? "https://login.microsoftonline.com/common/oauth2/v2.0/token", body)
    );
  }

  async refresh(refreshToken: string): Promise<TokenSet> {
    if (!this.config.clientId) throw new Error("Microsoft OAuth is not configured (missing client id)");
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken.trim(),
      client_id: this.config.clientId,
    });
    if (this.config.clientSecret) body.set("client_secret", this.config.clientSecret);

    return this.parseTokenSet(
      await formPost(this.config.tokenUrl ?? "https://login.microsoftonline.com/common/oauth2/v2.0/token", body),
      refreshToken
    );
  }

  async revoke(_tokenSet: TokenSet): Promise<void> {
    // Microsoft does not provide a standard token revocation endpoint for personal accounts
  }

  async userInfo(accessToken: string): Promise<Record<string, unknown>> {
    if (!accessToken) throw new Error("Microsoft userinfo failed: missing access token");
    const res = await fetch(`${this.config.apiBase ?? "https://graph.microsoft.com"}/v1.0/me`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`Microsoft userinfo failed with HTTP ${res.status}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  private parseTokenSet(record: Record<string, unknown>, fallbackRefreshToken?: string): TokenSet {
    if (typeof record["access_token"] !== "string" || !record["access_token"]) {
      throw new Error("Microsoft OAuth token response missing access_token");
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

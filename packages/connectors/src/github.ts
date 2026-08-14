import type { OAuthProvider, TokenSet } from "@zagros/kernel";
import type { OAuthAppConfig } from "./config.js";

const DEFAULT_TIMEOUT_MS = 30_000;

function enc(value: string): string {
  return encodeURIComponent(value);
}

function b64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export class GitHubProvider implements OAuthProvider {
  readonly id = "github";
  readonly label = "GitHub";
  readonly scopes = ["repo", "read:org"];

  constructor(private readonly config: OAuthAppConfig) {}

  buildAuthorizeUrl(opts: { redirectUri: string; state: string; codeChallenge: string }): string {
    if (!this.config.clientId) {
      throw new Error("GitHub OAuth is not configured (missing client id)");
    }
    const pkceParam = opts.codeChallenge
      ? `&code_challenge=${enc(opts.codeChallenge)}&code_challenge_method=S256`
      : "";
    return (
      `${this.config.authorizeUrl ?? "https://github.com/login/oauth/authorize"}?` +
      `client_id=${enc(this.config.clientId)}` +
      `&redirect_uri=${enc(opts.redirectUri)}` +
      `&state=${enc(opts.state)}` +
      `&scope=${enc(this.scopes.join(" "))}` +
      pkceParam
    );
  }

  async exchangeCode(opts: { code: string; redirectUri: string; codeVerifier: string }): Promise<TokenSet> {
    if (!this.config.clientId) throw new Error("GitHub OAuth is not configured (missing client id)");
    if (!this.config.clientSecret) {
      throw new Error("GitHub OAuth is not configured (missing client secret)");
    }
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code: opts.code,
      redirect_uri: opts.redirectUri,
    });
    if (opts.codeVerifier) {
      body.set("code_verifier", opts.codeVerifier);
    }

    let res: Response;
    try {
      res = await fetch(
        this.config.tokenUrl ?? "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json",
          },
          body: body.toString(),
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        }
      );
    } catch (err) {
      throw new Error(`GitHub OAuth code exchange network error: ${err instanceof Error ? err.message : String(err)}`);
    }

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }

    if (!res.ok) {
      throw new Error(`GitHub OAuth request failed with HTTP ${res.status}`);
    }

    if (typeof parsed !== "object" || parsed === null) {
      throw new Error(`GitHub OAuth request failed: invalid JSON response (HTTP ${res.status})`);
    }

    const record = parsed as Record<string, unknown>;
    if (typeof record["error"] === "string") {
      const desc = typeof record["error_description"] === "string" ? `: ${record["error_description"]}` : "";
      throw new Error(`GitHub OAuth code exchange failed (${record["error"]}${desc})`);
    }

    if (typeof record["access_token"] !== "string" || !record["access_token"]) {
      throw new Error("GitHub OAuth token response missing access_token");
    }

    return {
      accessToken: record["access_token"],
      refreshToken: typeof record["refresh_token"] === "string" ? record["refresh_token"] : undefined,
      expiresIn: typeof record["expires_in"] === "number" ? record["expires_in"] : undefined,
      scope: typeof record["scope"] === "string" ? record["scope"] : undefined,
      tokenType: typeof record["token_type"] === "string" ? record["token_type"] : undefined,
    };
  }

  async refresh(refreshToken: string): Promise<TokenSet> {
    if (!this.config.clientId) throw new Error("GitHub OAuth is not configured (missing client id)");
    if (!this.config.clientSecret) throw new Error("GitHub OAuth is not configured (missing client secret)");
    if (!refreshToken || typeof refreshToken !== "string" || !refreshToken.trim()) {
      throw new Error("GitHub OAuth refresh failed: missing refresh token");
    }

    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken.trim(),
    });

    let res: Response;
    try {
      res = await fetch(
        this.config.tokenUrl ?? "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json",
          },
          body: body.toString(),
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        }
      );
    } catch (err) {
      throw new Error(`GitHub OAuth token refresh network error: ${err instanceof Error ? err.message : String(err)}`);
    }

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }

    if (!res.ok) {
      throw new Error(`GitHub OAuth token refresh failed with HTTP ${res.status}`);
    }

    if (typeof parsed !== "object" || parsed === null) {
      throw new Error(`GitHub OAuth token refresh failed: invalid JSON response (HTTP ${res.status})`);
    }

    const record = parsed as Record<string, unknown>;
    if (typeof record["error"] === "string") {
      const desc = typeof record["error_description"] === "string" ? `: ${record["error_description"]}` : "";
      throw new Error(`GitHub OAuth token refresh failed (${record["error"]}${desc})`);
    }

    if (typeof record["access_token"] !== "string" || !record["access_token"]) {
      throw new Error("GitHub OAuth token refresh response missing access_token");
    }

    return {
      accessToken: record["access_token"],
      refreshToken: typeof record["refresh_token"] === "string" && record["refresh_token"] ? record["refresh_token"] : refreshToken,
      expiresIn: typeof record["expires_in"] === "number" ? record["expires_in"] : undefined,
      scope: typeof record["scope"] === "string" ? record["scope"] : undefined,
      tokenType: typeof record["token_type"] === "string" ? record["token_type"] : undefined,
    };
  }

  async revoke(tokenSet: TokenSet): Promise<void> {
    if (!this.config.clientId || !this.config.clientSecret) return;
    try {
      await fetch(`${this.config.apiBase ?? "https://api.github.com"}/applications/${enc(this.config.clientId)}/token`, {
        method: "DELETE",
        headers: {
          authorization: `Basic ${b64(`${this.config.clientId}:${this.config.clientSecret}`)}`,
          accept: "application/vnd.github+json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ access_token: tokenSet.accessToken }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Best-effort revocation
    }
  }

  async userInfo(accessToken: string): Promise<Record<string, unknown>> {
    if (!accessToken) throw new Error("GitHub userinfo failed: missing access token");
    let res: Response;
    try {
      res = await fetch(`${this.config.apiBase ?? "https://api.github.com"}/user`, {
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/vnd.github+json",
          "user-agent": "zagros",
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new Error(`GitHub userinfo network error: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!res.ok) {
      throw new Error(`GitHub userinfo failed with HTTP ${res.status}`);
    }

    const parsed: unknown = await res.json().catch(() => undefined);
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("GitHub userinfo returned an invalid response");
    }
    return parsed as Record<string, unknown>;
  }
}

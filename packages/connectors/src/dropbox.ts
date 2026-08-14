import type { OAuthProvider, TokenSet } from "@zagros/kernel";
import type { OAuthAppConfig } from "./config.js";

const DEFAULT_TIMEOUT_MS = 30_000;

function enc(value: string): string {
  return encodeURIComponent(value);
}

export class DropboxProvider implements OAuthProvider {
  readonly id = "dropbox";
  readonly label = "Dropbox";
  readonly scopes = ["files.metadata.read", "files.content.read", "files.content.write"];

  constructor(private readonly config: OAuthAppConfig = {}) {}

  buildAuthorizeUrl(opts: { redirectUri: string; state: string; codeChallenge: string }): string {
    if (!this.config.clientId) {
      throw new Error("Dropbox OAuth is not configured (missing client id)");
    }
    const pkceParam = opts.codeChallenge
      ? `&code_challenge=${enc(opts.codeChallenge)}&code_challenge_method=S256`
      : "";
    return (
      `${this.config.authorizeUrl ?? "https://www.dropbox.com/oauth2/authorize"}?` +
      `client_id=${enc(this.config.clientId)}` +
      `&response_type=code&token_access_type=offline` +
      `&redirect_uri=${enc(opts.redirectUri)}` +
      `&scope=${enc(this.scopes.join(" "))}` +
      `&state=${enc(opts.state)}` +
      pkceParam
    );
  }

  async exchangeCode(opts: { code: string; redirectUri: string; codeVerifier: string }): Promise<TokenSet> {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new Error("Dropbox OAuth is not configured (missing client credentials)");
    }
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
    });
    if (opts.codeVerifier) body.set("code_verifier", opts.codeVerifier);

    const res = await fetch(this.config.tokenUrl ?? "https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok || data.error) {
      throw new Error(`Dropbox OAuth error: ${data.error_description ?? data.error ?? res.statusText}`);
    }

    const accessToken = (data.access_token as string) ?? "";
    if (!accessToken) throw new Error("Dropbox OAuth exchange returned no access_token");

    return {
      accessToken,
      refreshToken: (data.refresh_token as string) ?? undefined,
      expiresIn: typeof data.expires_in === "number" ? data.expires_in : undefined,
      scope: typeof data.scope === "string" ? data.scope : this.scopes.join(" "),
      tokenType: "Bearer",
    };
  }

  async refresh(refreshToken: string): Promise<TokenSet> {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new Error("Dropbox OAuth is not configured (missing client credentials)");
    }
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    const res = await fetch(this.config.tokenUrl ?? "https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok || data.error) {
      throw new Error(`Dropbox OAuth refresh error: ${data.error_description ?? data.error ?? res.statusText}`);
    }

    const accessToken = (data.access_token as string) ?? "";
    if (!accessToken) throw new Error("Dropbox OAuth refresh returned no access_token");

    return {
      accessToken,
      refreshToken: (data.refresh_token as string) ?? refreshToken,
      expiresIn: typeof data.expires_in === "number" ? data.expires_in : undefined,
      scope: typeof data.scope === "string" ? data.scope : this.scopes.join(" "),
      tokenType: "Bearer",
    };
  }

  async revoke(tokenSet: TokenSet): Promise<void> {
    if (!tokenSet.accessToken) return;
    try {
      await fetch("https://api.dropboxapi.com/2/auth/token/revoke", {
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
    if (!accessToken) throw new Error("Dropbox userinfo failed: missing access token");
    const res = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Dropbox userinfo failed with HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }
}

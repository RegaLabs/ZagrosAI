import { describe, expect, it, vi } from "vitest";
import { GoogleProvider, GitHubProvider } from "../src/index.js";

describe("GoogleProvider (OAuth 2.1 & PKCE)", () => {
  const config = {
    clientId: "google-test-client-id",
    clientSecret: "google-test-client-secret",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    apiBase: "https://www.googleapis.com",
  };

  it("builds a compliant OAuth 2.1 PKCE authorization URL", () => {
    const provider = new GoogleProvider(config);
    const urlStr = provider.buildAuthorizeUrl({
      redirectUri: "https://app.zagros.ai/oauth/callback",
      state: "state-token-1234",
      codeChallenge: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    });

    const url = new URL(urlStr);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("google-test-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.zagros.ai/oauth/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("state-token-1234");
    expect(url.searchParams.get("code_challenge")).toBe("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toContain("openid");
  });

  it("throws if Google clientId is missing during authorization URL build", () => {
    const provider = new GoogleProvider({});
    expect(() =>
      provider.buildAuthorizeUrl({
        redirectUri: "https://app.zagros.ai/oauth/callback",
        state: "123",
        codeChallenge: "abc",
      })
    ).toThrow(/missing client id/);
  });

  it("exchanges authorization code with code_verifier for token set", async () => {
    const provider = new GoogleProvider(config);
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(
        JSON.stringify({
          access_token: "ya29.google-test-access-token",
          refresh_token: "1//04google-refresh-token",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "openid profile email",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", mockFetch);

    const tokenSet = await provider.exchangeCode({
      code: "google-auth-code-123",
      redirectUri: "https://app.zagros.ai/oauth/callback",
      codeVerifier: "high-entropy-pkce-verifier-string-43-chars-min",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(capturedUrl).toBe("https://oauth2.googleapis.com/token");
    expect(capturedInit?.method).toBe("POST");

    const bodyParams = new URLSearchParams(String(capturedInit?.body ?? ""));
    expect(bodyParams.get("grant_type")).toBe("authorization_code");
    expect(bodyParams.get("code")).toBe("google-auth-code-123");
    expect(bodyParams.get("client_id")).toBe("google-test-client-id");
    expect(bodyParams.get("client_secret")).toBe("google-test-client-secret");
    expect(bodyParams.get("code_verifier")).toBe("high-entropy-pkce-verifier-string-43-chars-min");

    expect(tokenSet.accessToken).toBe("ya29.google-test-access-token");
    expect(tokenSet.refreshToken).toBe("1//04google-refresh-token");
    expect(tokenSet.expiresIn).toBe(3600);
  });

  it("refreshes access token and preserves existing refresh token if provider does not return a new one", async () => {
    const provider = new GoogleProvider(config);
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "ya29.refreshed-access-token",
          expires_in: 3600,
          token_type: "Bearer",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    const tokenSet = await provider.refresh("1//04existing-refresh-token");
    expect(tokenSet.accessToken).toBe("ya29.refreshed-access-token");
    expect(tokenSet.refreshToken).toBe("1//04existing-refresh-token");
    expect(tokenSet.expiresIn).toBe(3600);
  });

  it("handles token refresh error boundaries cleanly (e.g. invalid_grant)", async () => {
    const provider = new GoogleProvider(config);
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Token has been expired or revoked.",
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(provider.refresh("1//04bad-refresh-token")).rejects.toThrow(
      /invalid_grant: Token has been expired or revoked/
    );
  });

  it("handles invalid response bodies during token exchange", async () => {
    const provider = new GoogleProvider(config);
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("<html>Server Error 500</html>", {
        status: 500,
        headers: { "content-type": "text/html" },
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      provider.exchangeCode({
        code: "123",
        redirectUri: "http://cb",
        codeVerifier: "ver",
      })
    ).rejects.toThrow(/HTTP 500/);
  });

  it("fetches user info and handles errors properly", async () => {
    const provider = new GoogleProvider(config);
    let capturedInit: RequestInit | undefined;
    const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return new Response(
        JSON.stringify({
          email: "dev@zagros.ai",
          name: "Zagros Developer",
          sub: "google-sub-12345",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", mockFetch);

    const info = await provider.userInfo("ya29.test-token");
    expect(info.email).toBe("dev@zagros.ai");
    expect(info.name).toBe("Zagros Developer");

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers?.authorization).toBe("Bearer ya29.test-token");
  });
});

describe("GitHubProvider (OAuth 2.1 & PKCE)", () => {
  const config = {
    clientId: "github-test-client-id",
    clientSecret: "github-test-client-secret",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    apiBase: "https://api.github.com",
  };

  it("builds a compliant OAuth 2.1 authorization URL with PKCE challenge", () => {
    const provider = new GitHubProvider(config);
    const urlStr = provider.buildAuthorizeUrl({
      redirectUri: "https://app.zagros.ai/oauth/callback",
      state: "state-gh-5678",
      codeChallenge: "challenge-sha256-string",
    });

    const url = new URL(urlStr);
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("github-test-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.zagros.ai/oauth/callback");
    expect(url.searchParams.get("state")).toBe("state-gh-5678");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-sha256-string");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("repo read:org");
  });

  it("exchanges code with code_verifier", async () => {
    const provider = new GitHubProvider(config);
    let capturedInit: RequestInit | undefined;
    const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return new Response(
        JSON.stringify({
          access_token: "ghu_1234567890abcdef",
          refresh_token: "ghr_abcdef1234567890",
          expires_in: 28800,
          token_type: "Bearer",
          scope: "repo,read:org",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", mockFetch);

    const tokenSet = await provider.exchangeCode({
      code: "gh-code-123",
      redirectUri: "https://app.zagros.ai/oauth/callback",
      codeVerifier: "gh-pkce-verifier-string",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const bodyParams = new URLSearchParams(String(capturedInit?.body ?? ""));
    expect(bodyParams.get("code")).toBe("gh-code-123");
    expect(bodyParams.get("code_verifier")).toBe("gh-pkce-verifier-string");
    expect(bodyParams.get("client_id")).toBe("github-test-client-id");
    expect(bodyParams.get("client_secret")).toBe("github-test-client-secret");

    expect(tokenSet.accessToken).toBe("ghu_1234567890abcdef");
    expect(tokenSet.refreshToken).toBe("ghr_abcdef1234567890");
    expect(tokenSet.expiresIn).toBe(28800);
  });

  it("handles GitHub OAuth error responses cleanly", async () => {
    const provider = new GitHubProvider(config);
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "bad_verification_code",
          error_description: "The code passed is incorrect or expired.",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      provider.exchangeCode({
        code: "expired-code",
        redirectUri: "http://cb",
        codeVerifier: "ver",
      })
    ).rejects.toThrow(/bad_verification_code: The code passed is incorrect or expired/);
  });

  it("refreshes expiring GitHub App user tokens", async () => {
    const provider = new GitHubProvider(config);
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "ghu_refreshed_access_token",
          refresh_token: "ghr_new_refresh_token",
          expires_in: 28800,
          token_type: "Bearer",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    const tokenSet = await provider.refresh("ghr_old_refresh_token");
    expect(tokenSet.accessToken).toBe("ghu_refreshed_access_token");
    expect(tokenSet.refreshToken).toBe("ghr_new_refresh_token");
    expect(tokenSet.expiresIn).toBe(28800);
  });

  it("handles GitHub user info retrieval and network errors", async () => {
    const provider = new GitHubProvider(config);
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          login: "octocat",
          id: 583231,
          name: "The Octocat",
          email: "octocat@github.com",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    const user = await provider.userInfo("ghu_test_token");
    expect(user.login).toBe("octocat");
    expect(user.id).toBe(583231);
    expect(user.email).toBe("octocat@github.com");
  });
});

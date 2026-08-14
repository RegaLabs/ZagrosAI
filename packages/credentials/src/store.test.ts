import { describe, expect, it } from "vitest";
import {
  CredentialStore,
  generateMasterKey,
  bytesToB64Url,
  b64UrlToBytes,
  maskSecret,
  scrubSensitiveText,
  sanitizeAuditDetail,
} from "../src/index.js";

describe("CredentialStore", () => {
  it("encrypts and decrypts round-trip correctly", async () => {
    const key = generateMasterKey();
    const store = new CredentialStore(key);
    const complexData = {
      accessToken: "gho_1234567890abcdefghijklmnopqrstuvwxyz",
      refreshToken: "ghr_abcdef1234567890",
      expiresIn: 3600,
      scope: "repo read:org",
      nested: { num: 42, flag: true, list: ["a", "b", "c"] },
      unicode: "Zagros — ڕێگای زیرەکی 🚀 🔒",
    };

    const payload = await store.encrypt(complexData);
    expect(payload).not.toContain("gho_1234567890abcdef");
    expect(payload).not.toContain("Zagros");

    const parsed = JSON.parse(payload) as { v: number; iv: string; ct: string };
    expect(parsed.v).toBe(1);
    expect(parsed.iv).toBeDefined();
    expect(parsed.ct).toBeDefined();

    const decrypted = await store.decrypt<typeof complexData>(payload);
    expect(decrypted).toEqual(complexData);
  });

  it("produces unique IVs and unique ciphertexts for identical inputs (IV uniqueness)", async () => {
    const store = new CredentialStore(generateMasterKey());
    const data = { secret: "constant-payload" };
    const ivs = new Set<string>();
    const cts = new Set<string>();

    const iterations = 50;
    for (let i = 0; i < iterations; i++) {
      const payload = await store.encrypt(data);
      const parsed = JSON.parse(payload) as { iv: string; ct: string };
      ivs.add(parsed.iv);
      cts.add(parsed.ct);
    }

    expect(ivs.size).toBe(iterations);
    expect(cts.size).toBe(iterations);
  });

  it("is disabled without a secret and rejects encryption/decryption", async () => {
    const storeEmpty = new CredentialStore("");
    const storeUndefined = new CredentialStore(undefined);
    const storeWhitespace = new CredentialStore("   ");

    expect(storeEmpty.enabled).toBe(false);
    expect(storeUndefined.enabled).toBe(false);
    expect(storeWhitespace.enabled).toBe(false);

    await expect(storeEmpty.encrypt({ test: 1 })).rejects.toThrow(/not configured/);
    await expect(storeUndefined.decrypt("{}")).rejects.toThrow(/not configured/);
    await expect(storeWhitespace.encrypt({ test: 1 })).rejects.toThrow(/not configured/);
  });

  it("enforces key derivation isolation (cannot decrypt with a different key)", async () => {
    const storeA = new CredentialStore("master-key-alpha-32-chars-length");
    const storeB = new CredentialStore("master-key-bravo-32-chars-length");

    const payloadA = await storeA.encrypt({ secretValue: 9999 });
    await expect(storeB.decrypt(payloadA)).rejects.toThrow(/Decryption failed/);
  });

  it("detects and rejects tampered ciphertext (authenticated encryption integrity)", async () => {
    const store = new CredentialStore(generateMasterKey());
    const payload = await store.encrypt({ secret: "tamper-test" });
    const parsed = JSON.parse(payload) as { v: 1; iv: string; ct: string };

    // Tamper with ciphertext bytes
    const ctBytes = Uint8Array.from(atob(parsed.ct), (c) => c.charCodeAt(0));
    const lastIdx = ctBytes.length - 1;
    ctBytes[lastIdx] = (ctBytes[lastIdx] ?? 0) ^ 0xff; // flip bits in authentication tag / ciphertext
    let binary = "";
    for (const byte of ctBytes) binary += String.fromCharCode(byte);
    const tamperedCt = btoa(binary);

    const tamperedPayload = JSON.stringify({ ...parsed, ct: tamperedCt });
    await expect(store.decrypt(tamperedPayload)).rejects.toThrow(/Decryption failed/);
  });

  it("detects and rejects tampered IV", async () => {
    const store = new CredentialStore(generateMasterKey());
    const payload = await store.encrypt({ secret: "iv-tamper-test" });
    const parsed = JSON.parse(payload) as { v: 1; iv: string; ct: string };

    // Tamper with IV bytes
    const ivBytes = Uint8Array.from(atob(parsed.iv), (c) => c.charCodeAt(0));
    ivBytes[0] = (ivBytes[0] ?? 0) ^ 0x01;
    let binary = "";
    for (const byte of ivBytes) binary += String.fromCharCode(byte);
    const tamperedIv = btoa(binary);

    const tamperedPayload = JSON.stringify({ ...parsed, iv: tamperedIv });
    await expect(store.decrypt(tamperedPayload)).rejects.toThrow(/Decryption failed/);
  });

  it("rejects invalid or malformed encrypted payload structures", async () => {
    const store = new CredentialStore(generateMasterKey());

    await expect(store.decrypt("not-json")).rejects.toThrow(/invalid JSON/);
    await expect(store.decrypt(JSON.stringify({ v: 2, iv: "abc", ct: "def" }))).rejects.toThrow(/invalid schema/);
    await expect(store.decrypt(JSON.stringify({ v: 1, iv: "", ct: "def" }))).rejects.toThrow(/invalid schema/);
    await expect(store.decrypt(JSON.stringify({ v: 1, iv: "???", ct: "!!!" }))).rejects.toThrow();
  });

  it("generates 32-byte (64 hex characters) cryptographic master keys", () => {
    const key1 = generateMasterKey();
    const key2 = generateMasterKey();

    expect(key1).toMatch(/^[0-9a-f]{64}$/);
    expect(key2).toMatch(/^[0-9a-f]{64}$/);
    expect(key1).not.toBe(key2);
  });

  it("converts bytes to and from base64url safely without URL special chars", () => {
    const randomBytes = crypto.getRandomValues(new Uint8Array(48));
    const b64url = bytesToB64Url(randomBytes);

    expect(b64url).not.toContain("+");
    expect(b64url).not.toContain("/");
    expect(b64url).not.toContain("=");

    const recoveredBytes = b64UrlToBytes(b64url);
    expect(recoveredBytes).toEqual(randomBytes);
  });
});

describe("Secret Masking and Audit Sanitization", () => {
  it("masks secrets appropriately based on length", () => {
    expect(maskSecret("short")).toBe("[REDACTED]");
    expect(maskSecret("sk-ant-1234567890abcdef", 4)).toBe("sk-a...cdef");
    expect(maskSecret("")).toBe("");
  });

  it("scrubs recognized token patterns from text", () => {
    const log = "Connecting with Bearer ya29.a0AfH6SMD123456 and token ghp_123456789012345678901234567890123456";
    const scrubbed = scrubSensitiveText(log);
    expect(scrubbed).not.toContain("ya29.");
    expect(scrubbed).not.toContain("ghp_");
    expect(scrubbed).toContain("[REDACTED_GOOGLE_TOKEN]");
    expect(scrubbed).toContain("[REDACTED_GITHUB_TOKEN]");
  });

  it("scrubs query parameter secrets in URLs", () => {
    const url = "https://example.com/callback?code_verifier=high-entropy-verifier&access_token=ya29.secret&state=xyz123";
    const scrubbed = scrubSensitiveText(url);
    expect(scrubbed).toContain("code_verifier=[REDACTED]");
    expect(scrubbed).toContain("access_token=[REDACTED]");
    expect(scrubbed).toContain("state=xyz123");
  });

  it("deeply sanitizes audit detail objects", () => {
    const auditDetail = {
      provider: "google",
      account: "user@example.com",
      accessToken: "ya29.secret-access-token",
      refreshToken: "1//04secret-refresh-token",
      codeVerifier: "my-pkce-verifier-value",
      metadata: {
        clientSecret: "super-secret-key",
        safeNote: "connection successful",
      },
    };

    const sanitized = sanitizeAuditDetail(auditDetail);
    expect(sanitized.provider).toBe("google");
    expect(sanitized.account).toBe("user@example.com");
    expect(sanitized.accessToken).not.toContain("secret-access-token");
    expect(sanitized.refreshToken).not.toContain("secret-refresh-token");
    expect(sanitized.codeVerifier).not.toContain("my-pkce-verifier-value");
    expect(sanitized.metadata.clientSecret).not.toContain("super-secret-key");
    expect(sanitized.metadata.safeNote).toBe("connection successful");
  });
});

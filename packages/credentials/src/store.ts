import type { webcrypto } from "node:crypto";

type CryptoKey = webcrypto.CryptoKey;

export interface EncryptedPayload {
  v: 1;
  iv: string;
  ct: string;
}

function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function b64ToBytes(b64: string): Uint8Array {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    throw new Error("Invalid base64 encoding in encrypted payload");
  }
}

function b64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return b64ToBytes(padded);
}

function bytesToB64Url(bytes: Uint8Array): string {
  return bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const salt = new TextEncoder().encode("zagros-master-salt-v1");
  const info = new TextEncoder().encode("zagros-credential-key-v1");
  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "HKDF",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export class CredentialStore {
  readonly enabled: boolean;
  private readonly secret: string | undefined;
  private keyPromise: Promise<CryptoKey> | undefined;

  constructor(secret: string | undefined) {
    this.secret = typeof secret === "string" && secret.trim().length > 0 ? secret.trim() : undefined;
    this.enabled = this.secret !== undefined;
  }

  private getKey(): Promise<CryptoKey> {
    if (!this.enabled || !this.secret) {
      throw new Error(
        "Credential encryption is not configured. Set ZAGROS_MASTER_KEY (or data/master.key locally) to enable OAuth connectors."
      );
    }
    if (!this.keyPromise) {
      this.keyPromise = deriveKey(this.secret);
    }
    return this.keyPromise;
  }

  async encrypt(plaintext: unknown): Promise<string> {
    const key = await this.getKey();
    // 96-bit (12-byte) cryptographically secure IV guarantees uniqueness for AES-GCM
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(plaintext));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
    const payload: EncryptedPayload = {
      v: 1,
      iv: bytesToB64(iv),
      ct: bytesToB64(new Uint8Array(ciphertext)),
    };
    return JSON.stringify(payload);
  }

  async decrypt<T = unknown>(payload: string): Promise<T> {
    const key = await this.getKey();
    let parsed: EncryptedPayload;
    try {
      parsed = JSON.parse(payload) as EncryptedPayload;
    } catch {
      throw new Error("Unsupported credential payload: invalid JSON");
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      parsed.v !== 1 ||
      typeof parsed.iv !== "string" ||
      typeof parsed.ct !== "string" ||
      !parsed.iv ||
      !parsed.ct
    ) {
      throw new Error("Unsupported credential payload: invalid schema");
    }

    const iv = b64ToBytes(parsed.iv);
    const ct = b64ToBytes(parsed.ct);

    let plaintext: ArrayBuffer;
    try {
      plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        ct
      );
    } catch {
      throw new Error("Decryption failed: authentication tag mismatch, tampered ciphertext, or invalid key");
    }

    try {
      const decoded = new TextDecoder().decode(plaintext);
      return JSON.parse(decoded) as T;
    } catch {
      throw new Error("Decryption failed: corrupted plaintext payload");
    }
  }
}

export function generateMasterKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export { b64UrlToBytes, bytesToB64Url };

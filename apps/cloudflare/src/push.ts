export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: string;
}

interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

interface PushSubscriptionRow {
  endpoint: string;
  keys_json: string;
  created_at: string;
}

interface VapidKeys {
  jwtSigningKey: CryptoKey;
  publicKeyB64url: string;
}

interface EcPoint {
  x: bigint;
  y: bigint;
}

const TEXT_ENCODER = new TextEncoder();

const P256_P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
const P256_A = P256_P - 3n;
const P256_B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
const P256_GX = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n;
const P256_GY = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n;

export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function uint8ArrayToUrlBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function bigintToBytes32(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let remaining = value;
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

function bytesToBigint(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function modPow(base: bigint, exponent: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function modInverse(value: bigint, mod: bigint): bigint {
  return modPow(((value % mod) + mod) % mod, mod - 2n, mod);
}

function pointDouble(point: EcPoint): EcPoint {
  const { x, y } = point;
  const slope = ((3n * x * x + P256_A) % P256_P) * modInverse(2n * y, P256_P);
  const slopeMod = ((slope % P256_P) + P256_P) % P256_P;
  const x3 = (((slopeMod * slopeMod - 2n * x) % P256_P) + P256_P) % P256_P;
  const y3 = (((slopeMod * (x - x3) - y) % P256_P) + P256_P) % P256_P;
  return { x: x3, y: y3 };
}

function pointAdd(a: EcPoint, b: EcPoint): EcPoint {
  if (a.x === 0n && a.y === 1n) return b;
  if (b.x === 0n && b.y === 1n) return a;
  if (a.x === b.x) {
    if (a.y === b.y) return pointDouble(a);
    return { x: 0n, y: 1n };
  }
  const slope = ((b.y - a.y) % P256_P) * modInverse(b.x - a.x, P256_P);
  const slopeMod = ((slope % P256_P) + P256_P) % P256_P;
  const x3 = (((slopeMod * slopeMod - a.x - b.x) % P256_P) + P256_P) % P256_P;
  const y3 = (((slopeMod * (a.x - x3) - a.y) % P256_P) + P256_P) % P256_P;
  return { x: x3, y: y3 };
}

function scalarMult(scalar: bigint, point: EcPoint): EcPoint {
  let result = { x: 0n, y: 1n };
  let addend = point;
  let remaining = scalar;
  while (remaining > 0n) {
    if (remaining & 1n) result = pointAdd(result, addend);
    addend = pointDouble(addend);
    remaining >>= 1n;
  }
  return result;
}

function derivePublicPoint(privateScalar: Uint8Array): EcPoint {
  return scalarMult(bytesToBigint(privateScalar), { x: P256_GX, y: P256_GY });
}

function normalizeSignature(signature: Uint8Array): Uint8Array {
  if (signature.byteLength === 64) return signature;
  if (signature[0] !== 0x30) throw new Error("invalid ECDSA signature");
  let offset = 2;
  const readInteger = (): Uint8Array => {
    if (signature[offset] !== 0x02) throw new Error("invalid DER signature");
    const length = signature[offset + 1];
    if (length === undefined || length === 0 || offset + 2 + length > signature.length) throw new Error("invalid DER signature");
    let value = signature.slice(offset + 2, offset + 2 + length);
    offset += 2 + length;
    let start = 0;
    while (start < value.length - 1 && value[start] === 0) start += 1;
    value = value.slice(start);
    if (value.length > 32) value = value.slice(value.length - 32);
    const out = new Uint8Array(32);
    out.set(value, 32 - value.length);
    return out;
  };
  const r = readInteger();
  const s = readInteger();
  return concatBytes(r, s);
}

function buildPublicKeyBytes(xB64: string, yB64: string): Uint8Array {
  const out = new Uint8Array(65);
  out[0] = 0x04;
  out.set(urlBase64ToUint8Array(xB64), 1);
  out.set(urlBase64ToUint8Array(yB64), 33);
  return out;
}

async function importVapidPrivateKey(privateKeyB64: string): Promise<VapidKeys> {
  const raw = urlBase64ToUint8Array(privateKeyB64);
  let d = "";
  let x = "";
  let y = "";
  try {
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as { kty?: string; crv?: string; d?: string; x?: string; y?: string };
    if (parsed.kty === "EC" && parsed.crv === "P-256" && typeof parsed.d === "string") {
      d = parsed.d;
      x = parsed.x ?? "";
      y = parsed.y ?? "";
    }
  } catch {

  }
  if (d === "") {
    if (raw.byteLength !== 32) throw new Error("VAPID private key must be a base64url JWK or a raw 32-byte P-256 scalar");
    d = privateKeyB64;
    const point = derivePublicPoint(raw);
    x = uint8ArrayToUrlBase64(bigintToBytes32(point.x));
    y = uint8ArrayToUrlBase64(bigintToBytes32(point.y));
  } else if (x === "" || y === "") {
    const point = derivePublicPoint(urlBase64ToUint8Array(d));
    x = uint8ArrayToUrlBase64(bigintToBytes32(point.x));
    y = uint8ArrayToUrlBase64(bigintToBytes32(point.y));
  }
  const jwtSigningKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", d, x, y },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  return { jwtSigningKey, publicKeyB64url: uint8ArrayToUrlBase64(buildPublicKeyBytes(x, y)) };
}

async function buildVapidJwt(endpoint: string, key: CryptoKey): Promise<string> {
  const header = { typ: "JWT", alg: "ES256" };
  const claims = {
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: "mailto:zagros@example.com",
  };
  const signingInput = `${uint8ArrayToUrlBase64(TEXT_ENCODER.encode(JSON.stringify(header)))}.${uint8ArrayToUrlBase64(TEXT_ENCODER.encode(JSON.stringify(claims)))}`;
  const der = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, TEXT_ENCODER.encode(signingInput)));
  return `${signingInput}.${uint8ArrayToUrlBase64(normalizeSignature(der))}`;
}

async function hkdfExpand(prk: Uint8Array, info: string, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const prkCopy = new Uint8Array(prk);
  const prkKey = await crypto.subtle.importKey("raw", prkCopy, "HKDF", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: concatBytes(TEXT_ENCODER.encode(info), new Uint8Array([0])) },
    prkKey,
    length * 8
  );
  return new Uint8Array(derived);
}

async function encryptPayload(sub: PushSubscriptionRecord, payload: string): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = urlBase64ToUint8Array(sub.keys.p256dh);
  if (uaPublic.byteLength !== 65 || uaPublic[0] !== 0x04) throw new Error("invalid subscription public key");
  const authSecret = urlBase64ToUint8Array(sub.keys.auth);

  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const ephemeralJwk = (await crypto.subtle.exportKey("jwk", ephemeral.publicKey)) as { x: string; y: string };
  const asPublic = buildPublicKeyBytes(ephemeralJwk.x, ephemeralJwk.y);

  const uaPublicKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: uint8ArrayToUrlBase64(uaPublic.slice(1, 33)), y: uint8ArrayToUrlBase64(uaPublic.slice(33, 65)) },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaPublicKey }, ephemeral.privateKey, 256));

  const ecdhKey = await crypto.subtle.importKey("raw", ecdhSecret, "HKDF", false, ["deriveBits"]);
  const keyInfo = concatBytes(TEXT_ENCODER.encode("WebPush: info"), new Uint8Array([0]), uaPublic, asPublic);
  const prk = new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: authSecret, info: keyInfo }, ecdhKey, 256));

  const cekRaw = await hkdfExpand(prk, "Content-Encoding: aes128gcm", 16);
  const nonce = await hkdfExpand(prk, "Content-Encoding: nonce", 12);
  const cek = await crypto.subtle.importKey("raw", cekRaw, { name: "AES-GCM" }, false, ["encrypt"]);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const plaintext = TEXT_ENCODER.encode(payload);
  const record = concatBytes(plaintext, new Uint8Array([0x02]), new Uint8Array(1));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cek, record));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  return concatBytes(salt, rs, new Uint8Array([65]), asPublic, ciphertext);
}

export class PushService {
  private schemaReady = false;
  private vapid: Promise<VapidKeys | undefined> | undefined;

  constructor(
    private readonly db: D1Database,
    private readonly vapidPublicKey?: string,
    private readonly vapidPrivateKey?: string
  ) {}

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    await this.db.exec("CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, keys_json TEXT NOT NULL, created_at TEXT NOT NULL);");
    this.schemaReady = true;
  }

  private getVapidKeys(): Promise<VapidKeys | undefined> {
    if (!this.vapidPrivateKey) return Promise.resolve(undefined);
    if (!this.vapid) {
      this.vapid = importVapidPrivateKey(this.vapidPrivateKey)
        .then((keys) => ({
          ...keys,
          publicKeyB64url: this.vapidPublicKey ?? keys.publicKeyB64url,
        }))
        .catch(() => undefined);
    }
    return this.vapid;
  }

  async subscribe(sub: PushSubscriptionRecord): Promise<boolean> {
    await this.ensureSchema();
    await this.db
      .prepare("INSERT OR REPLACE INTO push_subscriptions (endpoint, keys_json, created_at) VALUES (?, ?, ?)")
      .bind(sub.endpoint, JSON.stringify(sub.keys), sub.createdAt)
      .run();
    return true;
  }

  async unsubscribe(endpoint: string): Promise<boolean> {
    await this.ensureSchema();
    await this.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(endpoint).run();
    return true;
  }

  async sendToAll(title: string, body: string, url?: string): Promise<{ sent: number; failed: number }> {
    await this.ensureSchema();
    const { results } = await this.db.prepare("SELECT * FROM push_subscriptions").all<PushSubscriptionRow>();
    let sent = 0;
    let failed = 0;
    for (const row of results) {
      try {
        let keys: PushSubscriptionRecord["keys"];
        try {
          keys = JSON.parse(row.keys_json) as PushSubscriptionRecord["keys"];
        } catch {
          failed += 1;
          continue;
        }
        if (!keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") {
          failed += 1;
          continue;
        }
        const record: PushSubscriptionRecord = {
          endpoint: row.endpoint,
          keys,
          createdAt: row.created_at,
        };
        const ok = await this.send(record, { title, body, url });
        if (ok) sent += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    return { sent, failed };
  }

  async send(sub: PushSubscriptionRecord, payload: PushPayload): Promise<boolean> {
    if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return false;
    const vapid = await this.getVapidKeys();
    if (!vapid) return false;
    try {
      const body = await encryptPayload(sub, JSON.stringify(payload));
      const jwt = await buildVapidJwt(sub.endpoint, vapid.jwtSigningKey);
      const response = await fetch(sub.endpoint, {
        method: "POST",
        headers: {
          TTL: "86400",
          Authorization: `vapid t=${jwt}, k=${vapid.publicKeyB64url}`,
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
        },
        body,
      });
      if (response.status === 201 || response.status === 202 || response.status === 204) return true;
      if (response.status === 404 || response.status === 410) {
        await this.unsubscribe(sub.endpoint).catch(() => undefined);
      }
      return false;
    } catch {
      return false;
    }
  }
}

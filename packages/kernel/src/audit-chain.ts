import { newId, now, type AuditEvent } from "@zagros/domain";
import { sanitizeAuditDetail } from "@zagros/credentials";
import type { Repos } from "@zagros/runtime";

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class AuditChainer {
  private lastHash: string | undefined;
  private loaded = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly inner: Repos) {
    return new Proxy(this, {
      get: (target, prop) => {
        if (prop === "appendAudit") return target.appendAudit.bind(target);
        const value = (target.inner as unknown as Record<PropertyKey, unknown>)[prop];
        if (typeof value === "function") return value.bind(target.inner);
        return value;
      },
    }) as unknown as AuditChainer;
  }

  async appendAudit(event: AuditEvent): Promise<void> {
    const run = this.queue.then(async () => {
      if (!this.loaded) {
        const events = await this.inner.listAudit(1);
        this.lastHash = hashOf(events[0]);
        this.loaded = true;
      }
      const sanitizedDetail = sanitizeAuditDetail(event.detail ?? {});
      const payload = `${event.type}|${event.createdAt}|${JSON.stringify(sanitizedDetail)}`;
      const hash = await sha256Hex(`${this.lastHash ?? ""}|${payload}`);
      const chained: AuditEvent = {
        ...event,
        detail: {
          ...sanitizedDetail,
          __hash: hash,
          __prevHash: this.lastHash ?? null,
          __chainPayload: payload.slice(0, 400),
        },
      };
      await this.inner.appendAudit(chained);
      this.lastHash = hash;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

function hashOf(event: AuditEvent | undefined): string | undefined {
  const detail = event?.detail;
  if (detail && typeof detail === "object" && "__hash" in detail) {
    const hash = (detail as Record<string, unknown>).__hash;
    if (typeof hash === "string") return hash;
  }
  return undefined;
}

export async function verifyAuditChain(events: AuditEvent[]): Promise<{ valid: boolean; brokenAt?: string }> {
  let prev: string | undefined;
  for (const event of [...events].reverse()) {
    const detail = (event.detail ?? {}) as Record<string, unknown>;
    const hash = typeof detail.__hash === "string" ? detail.__hash : undefined;
    const prevHash = detail.__prevHash === null ? undefined : typeof detail.__prevHash === "string" ? detail.__prevHash : undefined;
    if (!hash) return { valid: false, brokenAt: event.id };
    if (prevHash !== prev) return { valid: false, brokenAt: event.id };
    const payload = `${event.type}|${event.createdAt}|${JSON.stringify(event.detail ? { ...(event.detail as Record<string, unknown>), __hash: undefined, __prevHash: undefined, __chainPayload: undefined } : {})}`;
    const computed = await sha256Hex(`${prev ?? ""}|${payload}`);
    if (computed !== hash) return { valid: false, brokenAt: event.id };
    prev = hash;
  }
  return { valid: true };
}

export { newId, now };

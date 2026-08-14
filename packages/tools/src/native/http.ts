import { z } from "zod";
import { toolFromZod } from "../registry.js";

const MAX_BODY_BYTES = 1024 * 1024;

function parseBody(body: unknown, contentType: string | null): unknown {
  if (typeof body !== "string") return body;
  if (contentType?.includes("application/json")) {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  if (contentType?.startsWith("text/") || body.length < MAX_BODY_BYTES * 2) {
    return body.slice(0, MAX_BODY_BYTES);
  }
  return body.slice(0, MAX_BODY_BYTES);
}

export type DomainPolicy = (url: string) => string | undefined;

export function createHttpTools(policy?: DomainPolicy) {
  const httpFetch = toolFromZod({
    id: "http.fetch",
    provider: "native",
    description:
      "Perform a GET request against a URL. Use to read web pages, APIs, documentation or JSON endpoints. The response body is truncated to 1MB.",
    risk: "R0",
    idempotent: true,
    schema: z.object({
      url: z.string().url(),
      headers: z.record(z.string()).optional(),
      timeoutMs: z.number().int().min(100).max(120000).default(30000),
    }),
    execute: async (rawArgs) => {
      const args = rawArgs as { url: string; headers?: Record<string, string>; timeoutMs?: number };
      const policyError = policy?.(args.url);
      if (policyError) return { ok: false, error: policyError };
      try {
        const res = await fetch(args.url, {
          method: "GET",
          headers: args.headers ?? {},
          signal: AbortSignal.timeout(args.timeoutMs ?? 30_000),
          redirect: "follow",
        });
        const body = await res.text();
        return {
          ok: true,
          data: {
            status: res.status,
            statusText: res.statusText,
            contentType: res.headers.get("content-type"),
            headers: Object.fromEntries(res.headers.entries()),
            body: parseBody(body, res.headers.get("content-type")),
          },
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  const httpPost = toolFromZod({
    id: "http.post",
    provider: "native",
    description:
      "Perform a POST/PUT/PATCH/DELETE request against a URL. Modifies external state and requires approval.",
    risk: "R2",
    idempotent: false,
    schema: z.object({
      url: z.string().url(),
      method: z.enum(["POST", "PUT", "PATCH", "DELETE"]).default("POST"),
      headers: z.record(z.string()).optional(),
      body: z.unknown().optional(),
      timeoutMs: z.number().int().min(100).max(120000).default(30000),
    }),
    execute: async (rawArgs) => {
      const args = rawArgs as {
        url: string;
        method?: "POST" | "PUT" | "PATCH" | "DELETE";
        headers?: Record<string, string>;
        body?: unknown;
        timeoutMs?: number;
      };
      const policyError = policy?.(args.url);
      if (policyError) return { ok: false, error: policyError };
      try {
        const res = await fetch(args.url, {
          method: args.method ?? "POST",
          headers: args.headers ?? { "content-type": "application/json" },
          body: args.body !== undefined ? JSON.stringify(args.body) : undefined,
          signal: AbortSignal.timeout(args.timeoutMs ?? 30_000),
          redirect: "follow",
        });
        const text = await res.text();
        return {
          ok: true,
          data: {
            status: res.status,
            statusText: res.statusText,
            contentType: res.headers.get("content-type"),
            headers: Object.fromEntries(res.headers.entries()),
            body: parseBody(text, res.headers.get("content-type")),
          },
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  return [httpFetch, httpPost];
}

import { z } from "zod";
import type { Kernel } from "@zagros/kernel";
import { toolFromZod } from "@zagros/tools";
import { GitHubProvider } from "./github.js";
import { GoogleProvider } from "./google.js";
import { MicrosoftProvider } from "./microsoft.js";
import { SlackProvider } from "./slack.js";
import { NotionProvider } from "./notion.js";
import { DropboxProvider } from "./dropbox.js";
import type { ConnectorsConfig } from "./config.js";

const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

export function registerConnectors(kernel: Kernel, config: ConnectorsConfig): void {
  kernel.oauth.register(new GoogleProvider(config.google ?? {}));
  kernel.oauth.register(new GitHubProvider(config.github ?? {}));
  kernel.oauth.register(new MicrosoftProvider(config.microsoft ?? {}));
  kernel.oauth.register(new SlackProvider(config.slack ?? {}));
  kernel.oauth.register(new NotionProvider(config.notion ?? {}));
  kernel.oauth.register(new DropboxProvider(config.dropbox ?? {}));

  if (!kernel.tools.get("connector.github.api")) {
    kernel.tools.register(
      toolFromZod({
        id: "connector.github.api",
        provider: "native",
        description:
          "Call the GitHub REST API as the connected GitHub account (GET requests only). Requires a connected GitHub connector.",
        risk: "R0",
        idempotent: true,
        schema: z.object({
          path: z.string().regex(/^\//),
          method: z.enum(["GET", "HEAD"]).default("GET"),
          credentialId: z.string().optional(),
        }),
        execute: async (rawArgs) => {
          const args = rawArgs as { path?: string; method?: "GET" | "HEAD"; credentialId?: string };
          try {
            const creds = await kernel.oauth.list();
            const target = args.credentialId
              ? creds.find((c) => c.id === args.credentialId)
              : creds.find((c) => c.provider === "github");
            if (!target) {
              return { ok: false, error: "No GitHub connector connected. Connect one in Settings → Connections." };
            }
            const token = await kernel.oauth.accessToken(target.id);
            const res = await fetch(
              `${config.github?.apiBase ?? "https://api.github.com"}${args.path ?? ""}`,
              {
                method: args.method ?? "GET",
                headers: {
                  authorization: `Bearer ${token}`,
                  accept: "application/vnd.github+json",
                  "user-agent": "zagros",
                },
                signal: AbortSignal.timeout(DEFAULT_TOOL_TIMEOUT_MS),
              }
            );
            return {
              ok: res.ok,
              data: { status: res.status, body: await res.json().catch(() => null) },
              error: !res.ok ? `GitHub API returned HTTP ${res.status}` : undefined,
            };
          } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
          }
        },
      })
    );
  }

  if (!kernel.tools.get("connector.google.userinfo")) {
    kernel.tools.register(
      toolFromZod({
        id: "connector.google.userinfo",
        provider: "native",
        description: "Return profile info for the connected Google account.",
        risk: "R0",
        idempotent: true,
        schema: z.object({}),
        execute: async () => {
          try {
            const creds = await kernel.oauth.list();
            const target = creds.find((c) => c.provider === "google");
            if (!target) {
              return { ok: false, error: "No Google connector connected. Connect one in Settings → Connections." };
            }
            const token = await kernel.oauth.accessToken(target.id);
            const res = await fetch(
              `${config.google?.apiBase ?? "https://www.googleapis.com"}/oauth2/v2/userinfo`,
              {
                headers: { authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(DEFAULT_TOOL_TIMEOUT_MS),
              }
            );
            const body: unknown = await res.json().catch(() => null);
            return { ok: res.ok, data: body, error: !res.ok ? `Google API returned HTTP ${res.status}` : undefined };
          } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
          }
        },
      })
    );
  }
}

export { GoogleProvider } from "./google.js";
export { GitHubProvider } from "./github.js";
export { MicrosoftProvider } from "./microsoft.js";
export { SlackProvider } from "./slack.js";
export { NotionProvider } from "./notion.js";
export { DropboxProvider } from "./dropbox.js";
export type { ConnectorsConfig, OAuthAppConfig } from "./config.js";

import { z } from "zod";
import { toolFromZod, type ToolDefinition } from "../registry.js";

export interface NotificationToolDeps {
  send?: (args: { title: string; body: string; data?: Record<string, unknown> }) => Promise<boolean>;
}

export function createNotificationTools(deps: NotificationToolDeps = {}): ToolDefinition[] {
  const send = toolFromZod({
    id: "notification.send",
    provider: "native",
    description: "Send a push notification or toast to the user.",
    risk: "R1",
    idempotent: false,
    schema: z.object({
      title: z.string().min(1).describe("Notification header / title"),
      body: z.string().min(1).describe("Main message content"),
      data: z.record(z.unknown()).optional().describe("Optional payload data"),
    }),
    execute: async (args) => {
      const parsed = args as { title: string; body: string; data?: Record<string, unknown> };
      if (!deps.send) {
        return { ok: true, data: { sent: true, title: parsed.title } };
      }
      const sent = await deps.send(parsed);
      return { ok: sent, data: { sent } };
    },
  });

  return [send];
}

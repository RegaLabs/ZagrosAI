import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "./env.js";

export interface ScheduledTaskPayload {
  conversationId: string;
  messageId: string;
  at: string;
  baseUrl?: string;
}

export class ScheduledTaskWorkflow extends WorkflowEntrypoint<Env, ScheduledTaskPayload> {
  override async run(event: WorkflowEvent<ScheduledTaskPayload>, step: WorkflowStep) {
    if (!event.payload?.conversationId || !event.payload?.messageId) {
      return { ok: false, error: "missing_required_payload_fields" };
    }

    const parsedAt = Date.parse(event.payload.at);
    const delayMs = isNaN(parsedAt) ? 0 : Math.max(0, parsedAt - Date.now());
    if (delayMs > 0) {
      await step.sleep("wait-until-scheduled-time", delayMs);
    }

    return await step.do(
      "run-task",
      {
        retries: {
          limit: 5,
          delay: "5 seconds",
          backoff: "exponential",
        },
        timeout: "2 minutes",
      },
      async () => {
        const base = event.payload.baseUrl ?? this.env.MAIN_URL ?? "http://127.0.0.1:8788";
        const res = await fetch(`${base}/api/routines/run`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            conversationId: event.payload.conversationId,
            messageId: event.payload.messageId,
          }),
        });

        // If client error (e.g. 400 Bad Request, 404 Not Found), don't retry fruitlessly
        if (res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 408) {
          const errBody = (await res.json().catch(() => ({}))) as { error?: string };
          return { ok: false, error: errBody.error ?? `client_error_${res.status}` };
        }

        if (!res.ok) {
          throw new Error(`routine run failed with status: ${res.status}`);
        }

        return (await res.json()) as { ok: boolean; taskId?: string; status?: string };
      }
    );
  }
}


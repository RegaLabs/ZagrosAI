# @zagros/cloudflare

The Cloudflare Workers deployment of the Zagros control plane (roadmap v0.2.0, "Always-On Cloud"). It runs the same kernel, REST API, harness, and runner protocol as the local `@zagros/server`, but on the Cloudflare edge: the web app ships from the same Worker, conversations and tasks live in D1, uploads live in R2, and the agent loop runs inside a Durable Object so tasks continue even when the laptop is off.

## Architecture

- `src/index.ts` — the Worker entrypoint. Serves the REST API (`/api/*`), uploads from R2 (`/uploads/*`), the web app from the assets binding, and forwards `/ws` and `/ws/runner` to the Hub Durable Object.
- `src/hub.ts` — the `Hub` Durable Object. Holds client WebSockets and runner WebSockets, and executes tasks. A task is created in D1 by the main Worker (via `kernel.startRunDelegate`), then the Hub is asked to run it; the Hub keeps the request open for the duration of the run so the Durable Object is not evicted mid-task. Live `ServerEvent`s (message.delta, tool.started, task.updated) are streamed to connected clients, and a Web Push notification is sent when a task reaches a terminal state.
- `src/d1-repos.ts` — `D1Repos`, a `Repos` implementation over D1 with the same schema and SQL as the local SQLite store (settings, agents, conversations, messages, tasks, workers, uploads, audit).
- `src/r2-store.ts` — `R2ObjectStore`, an `ObjectStore` implementation over R2.
- `src/push.ts` — `PushService`: Web Push (RFC 8030/8291/8292) implemented with Web Crypto only. VAPID keys are accepted as a base64url-encoded JWK JSON or as a raw 32-byte base64url P-256 scalar (the `web-push` CLI private key format); a raw scalar has its public key derived in-process. Messages are encrypted per RFC 8291 + RFC 8188 (`aes128gcm`), verified against the RFC 8291 Appendix A test vector.
- `src/workflow.ts` — `ScheduledTaskWorkflow`: Cloudflare Workflows entrypoint used for scheduled/routine messages (`POST /api/routines/once` with `{conversationId, content, at}`). It sleeps until `at` and then calls `POST /api/routines/run`, which asks the Hub to run the task.

## Running locally

Requires Node 20+ and pnpm. The web app must be built first because the assets binding points at `../web/dist`:

```sh
pnpm install
pnpm -r --filter './packages/*' build
pnpm --filter @zagros/web build
pnpm --filter @zagros/cloudflare dev
```

This starts `wrangler dev --local` on `http://127.0.0.1:8788` — no Cloudflare account needed. D1, R2, Durable Objects, Workflows, and the assets binding all run locally (workerd). If the harness needs a model, point Settings at any OpenAI-compatible endpoint, e.g. the repo's mock model: `MOCK_MODEL_PORT=9898 node scripts/mock-model.mjs`, then `PUT /api/settings` with `{"defaultModel":{"driver":"openai-compatible","model":"mock","baseUrl":"http://127.0.0.1:9898/v1","apiKey":"mock"}}`.

For Web Push in local dev, add VAPID keys to `apps/cloudflare/.dev.vars`:

```
VAPID_PUBLIC_KEY=<base64url application server public key>
VAPID_PRIVATE_KEY=<base64url JWK or raw 32-byte scalar>
```

Push is a no-op (skipped) when `VAPID_PRIVATE_KEY` is not configured. In production, set the same variables as Worker secrets (`wrangler secret put VAPID_PRIVATE_KEY`) and `MAIN_URL` to the deployed Worker URL (used by the ScheduledTaskWorkflow to call back into `/api/routines/run`).

## Deploying

```sh
pnpm --filter @zagros/cloudflare deploy
```

Before the first deploy: create the D1 database (`wrangler d1 create zagrosai`) and the R2 bucket (`wrangler r2 bucket create zagros-files`) on your account and update `database_id` in `wrangler.jsonc`.

## Bindings

| Binding | Resource | Purpose |
| --- | --- | --- |
| `DB` | D1 | relational storage (settings, agents, conversations, messages, tasks, workers, uploads, audit, push subscriptions) |
| `FILES` | R2 | attachment objects served at `/uploads/*` |
| `HUB` | Durable Object | client/runner WebSockets + live task execution |
| `WORKFLOW` | Workflows | scheduled routine messages |
| `ASSETS` | static assets | the built web app (`../web/dist`) |
| `VERSION` | var | kernel version reported by `/api/health` |

## Honest limits

This is a real Cloudflare deployment and the Free plan has real constraints:

- **No arbitrary Linux compute.** `shell.exec`, `files.read`, `files.write` are runner tools: they need an Zagros Runner connected to `/ws/runner`. Without one they fail with a clear "no runner online" error (the model sees that error text). Native tools (`http.fetch`, `http.post`) run in-process.
- **Durable Object limits.** DO CPU is capped (~30s per invocation on paid plans, less on Free) and wall-clock work should stay well under ~15 minutes. The harness has a 10-minute default timeout, but a long model/tool loop can still exceed DO limits; the Free plan has no browser or GPU minutes to speak of. This deployment is aimed at short agent tasks, not batch jobs.
- **Workers/browser minutes.** Free-tier CPU minutes are shared across all scripts on the account, including this Worker and its DO.
- **No persistent local state between dev and prod.** Local dev uses a throwaway local D1/R2; nothing is shared with your account.

See https://developers.cloudflare.com/workers/ for the current limits.

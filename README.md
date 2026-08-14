# Zagros

**The open-source runtime for AI agents that keep working.**

Use your model. Use your tools. Use your computers.

Zagros gives AI agents persistent tasks, memory, files, browser automation, MCP tools, skills, approvals and hybrid local/cloud execution.

Your laptop can disappear without killing the agent. Cloud-capable work continues; machine-specific work resumes or moves to another available Runner.

```text
Any AI
  +
MCP tools
  +
Skills
  +
Your computers
  +
Optional serverless cloud
  =
Zagros
```

> **Working definition**
>
> **Zagros is an open-source operating system for persistent AI agents. Use any model. Connect any MCP tool. Bring existing provider-native agent subscriptions where officially supported. Run locally, serverlessly, or across your own machines. Close your laptop and let cloud-capable work continue.**

---

## Not the complete version

This project is **under active development and is NOT yet a complete or production-ready release.**

- The `v0.1.0 -> v1.0.0` milestones are **code milestones** — each is verified end-to-end by its own test suite, but the project as a whole is **experimental**.
- Public APIs, protocols, the skill format, the Runner protocol, storage layouts and configuration are **not frozen**. They can change between releases.
- Expect **breaking changes**, missing features, rough edges and bugs.
- Security boundaries exist (see [SECURITY.md](SECURITY.md)), but the codebase has **not** been externally audited. Do not use it for sensitive or irreversible operations yet.
- See [COMPATIBILITY.md](docs/COMPATIBILITY.md) for the stability level of each layer today, and [RELEASES.md](docs/RELEASES.md) for what a future stable 1.0 release will require.

If you build on Zagros, **pin a specific commit** and treat upgrades as migrations.

---

## Status

The ten roadmap milestones are implemented and verified end-to-end:

| Milestone | Theme | Verify |
|---|---|---|
| v0.1.0 | Kernel — PWA chat, models, tools, Runner, MCP, durable tasks | `pnpm verify` (20 checks) |
| v0.2.0 | Always-on cloud — Cloudflare adapter, Workflows, D1/R2, push | `pnpm verify:cloud` (17) |
| v0.3.0 | Connected work — MCP OAuth, connectors, encrypted credentials, approvals | `pnpm verify:v03` (26) |
| v0.4.0 | The computer — browser on Runners, screenshots, live view, pause/resume | `pnpm verify:v04` (17) |
| v0.5.0 | Memory + skills — extraction with provenance, SKILL.md system | `pnpm verify:v05` (18) |
| v0.6.0 | Any model, any harness — native drivers, fallbacks, ACP bridges | `pnpm verify:v06` (6) |
| v0.7.0 | Routines — schedules, webhooks, retries, dead-letter, expiry | `pnpm verify:v07` (16) |
| v0.8.0 | Multi-agent + A2A — delegation, parallel subtasks, Agent Cards | `pnpm verify:v08` (18) |
| v0.9.0 | Hardening — injection defenses, secret redaction, signed skills, audit chain | `pnpm verify:v09` (17) |
| v1.0.0 | Open Agent Operating System — both defining journeys verified | `pnpm verify:v1` (15) |

Every milestone's verify script spins up the real server (and Runners/mocks where needed) and exercises the actual HTTP/WS APIs. CI runs all ten on every push.

---

## Why Zagros?

**Model independent**

Use OpenAI, Claude, Gemini, Grok, open-weight models, local Ollama/vLLM models or any compatible provider. The OpenAI-compatible driver is first-class, with native Anthropic and Gemini drivers and per-agent fallback chains.

**Persistent**

Agents have durable tasks, state, files and memory. Tasks are state machines that survive browser refreshes, server restarts and machine loss.

**Hybrid**

Use serverless cloud execution for always-on work and Zagros Runners for browsers, terminals, local files, GPUs and desktop applications. When a machine goes offline, only the steps that need it wait — everything else continues.

**MCP native**

Connect standard MCP servers (stdio or remote HTTP, with OAuth 2.1 flows) instead of waiting for Zagros-specific integrations.

**Bring provider-native agents**

Zagros delegates to compatible provider-native agent harnesses (Codex, Claude Code, Gemini CLI) through ACP while leaving their authentication and execution under the provider's own tooling. Zagros does not scrape session cookies or call undocumented private APIs.

**Phone first**

Create agents, upload files/images/video, monitor work, approve actions and review results from a mobile browser or installed PWA. The v1.0 gauntlet verifies the whole phone-only journey.

**Open**

The runtime, protocols, Runner and skill system are open and self-hostable. Skills can be signed and trusted; memory and artifacts are exportable.

---

## Built on open protocols

```text
MCP
Agent <-> tools

ACP
Zagros <-> provider-native coding agents

A2A
Agent <-> external agent
```

Zagros extends these protocols rather than replacing them.

## Zagros is not another chat UI

A chatbot returns an answer. Zagros owns a task.

```text
Chatbot:
request -> answer

Zagros:
request
  -> plan
  -> execute
  -> wait
  -> recover
  -> ask permission
  -> continue
  -> verify
  -> deliver artifacts
```

---

## Quick start

Requirements: Node.js >= 20 (Node 22+ recommended), pnpm.

```bash
pnpm install
pnpm dev
```

- Server: http://127.0.0.1:8787 (REST API + WebSocket)
- Web app: http://localhost:5173 (installable PWA)

Connect a local Runner to give agents shell, filesystem and browser access:

```bash
pnpm --filter @zagros/runner build
node apps/runner/dist/index.js start \
  --url ws://127.0.0.1:8787/ws/runner \
  --name my-computer \
  --token <runner token from server logs or data/zagros.db>
```

Point the default model in **Settings** at any OpenAI-compatible endpoint (OpenAI, Ollama at `http://localhost:11434/v1`, LM Studio, vLLM, OpenRouter) or configure a Cloudflare Workers AI credential.

## Verify the milestones

```bash
pnpm verify          # v0.1.0 kernel
pnpm verify:cloud    # v0.2.0 cloud (wrangler dev --local)
pnpm verify:v03      # OAuth + approvals
pnpm verify:v04      # computer
pnpm verify:v05      # memory + skills
pnpm verify:v06      # models + ACP
pnpm verify:v07      # routines
pnpm verify:v08      # multi-agent + A2A
pnpm verify:v09      # hardening
pnpm verify:v1       # v1.0.0 gauntlet
```

## Benchmarks

```bash
node scripts/bench.mjs          # 20-task load run with p50/p95/success metrics
```

Example output on a desktop Linux machine:

```text
BENCH {"tasks":20,"succeeded":20,"successRate":100,"totalMs":2626,"avgMs":131,"p50Ms":132,"p95Ms":143,"modelCalls":20,"toolCalls":0}
```

Numbers vary by machine and model. The benchmark is reproducible and runs in CI.

---

## Architecture

```text
                       Zagros
                          |
               +----------+----------+
               |                     |
             Phone                Desktop
               |                     |
               +----------+----------+
                          |
                    RegaHarness
                          |
        +-----------------+-----------------+
        |                 |                 |
      Models             MCP              Skills
        |                 |                 |
        v                 v                 v
 OpenAI/Claude       GitHub/Drive      Community
 Gemini/Grok/etc.    Slack/etc.        workflows
        |
        v
                 Execution Fabric
                       |
       +---------------+-----------------+
       v               v                 v
 Cloudflare        Local Runner       Remote Runner
 durable work      laptop/GPU         NAS/server
```

```text
THE AGENT IS NOT THE MODEL.

Model = intelligence provider
MCP = tools
ACP = provider-native agent harnesses
A2A = external agents
Zagros = orchestration + memory + execution + UX + security
```

The control plane is a transport-agnostic kernel (`packages/kernel`) that runs on either runtime:

- **Local**: Node + SQLite + filesystem + Fastify (`apps/server`)
- **Cloudflare**: D1 + R2 + Durable Objects + Workflows (`apps/cloudflare`)

The same `Repos` and `ObjectStore` interfaces back both runtimes, so the kernel, harness, models, tools and protocols are identical.

## Security model

- **The model does not control your permissions.** The policy engine decides: R0/R1 auto, R2/R3 approval, per-agent `denyTools`/`approvalTools` overrides.
- **Prompt-injection defense**: data boundaries are labeled, and apiKeys/OAuth tokens are scrubbed from tool results before reaching the model.
- **Credentials at rest** are encrypted (AES-256-GCM, key derived from the master key); the database never holds decryptable credentials alone.
- **Signed skills**: with a configured public key, unsigned or mismatched skills are never injected into agent context.
- **Audit**: every event is hash-chained and verifiable end-to-end.
- **Provider boundaries**: subscription logins stay inside the provider's own harness (ACP); Zagros never reverse-engineers consumer authentication.

Full policy in [SECURITY.md](SECURITY.md).

## Optional always-on execution with Cloudflare

Zagros does not require a central cloud. The recommended serverless deployment places the control plane inside **your own Cloudflare account**:

```text
Workers        API and events
Durable state  live agent sessions
Workflows      background and scheduled work
D1             structured state
R2             files and artifacts
Browser Run    cloud browser tasks
Workers AI     optional model inference
```

**Cloudflare is a runtime adapter, not a requirement.**

### Honest limits

- The Cloudflare Free Workers environment is **not a free arbitrary Linux VM**. Container compute is not on the Free plan, so tasks needing a shell, browser or local files must run on a Zagros Runner.
- Durable Object invocations have CPU limits; very long or compute-heavy runs can exceed them. See https://developers.cloudflare.com/workers/ for the authoritative limits.
- Push notifications require VAPID keys.
- `wrangler dev --local` may log "request hung" warnings for requests held open while a task runs; production Workers allow this pattern.

## What happens when my computer is off?

Zagros separates the **agent** from the **computer**. If your laptop goes offline:

```text
[ok] conversations remain
[ok] memory remains
[ok] schedules remain
[ok] API/MCP work can continue
[ok] cloud models can continue
[ok] notifications continue
[wait] local files wait
[wait] local terminal commands wait
[wait] desktop applications wait
```

When the Runner reconnects, waiting steps resume automatically. If another compatible Runner exists, Zagros can route eligible work there instead.

## What Zagros cannot magically provide

There is no unlimited free cloud computer. Serverless execution keeps tasks, APIs, schedules and lightweight workloads alive with no dedicated VPS, but arbitrary Linux/desktop computation requires an available execution machine — your laptop, desktop, NAS, home server, a remote machine, or a compatible sandbox. Zagros's job is to make those resources behave like one execution fabric.

---

## Repository layout

```text
apps/
|-- server/     local control plane: kernel, SQLite, REST, WebSocket, uploads
|-- runner/     Zagros Runner: outbound-connecting executor (shell, files, browser)
|-- cloudflare/ Cloudflare deployment: D1/R2 adapters, Hub Durable Object, Workflows, push
`-- web/        React + TypeScript + Vite PWA

packages/
|-- domain/     zod schemas for all core domain objects
|-- protocol/   client protocol, runner protocol, REST contract
|-- models/     normalized ModelDriver interface + OpenAI-compatible/Anthropic/Gemini/Cloudflare drivers
|-- tools/      tool interface, risk metadata, native tools, registry
|-- mcp/        MCP clients: stdio + streamable HTTP (incl. OAuth 2.1), tool adapter, manager
|-- harness/    RegaHarness: context compiler -> model loop -> policy preflight -> tools -> checkpoint
|-- runtime/    runtime adapter seams: Repos (async) + ObjectStore interfaces
|-- credentials AES-256-GCM credential store (master-key derived, Web Crypto)
|-- connectors  OAuth providers (Google, GitHub) + connector tools
|-- skills/     SKILL.md + skill.yaml loader, discovery, signature verification, git installs
|-- acp/        ACP client (provider harness bridge over stdio JSON-RPC)
|-- a2a/        A2A client/server (Agent Cards, JSON-RPC message/send)
`-- kernel/     transport-agnostic kernel: HTTP handlers, WS hub, approvals, memory, skills, audit
```

## Governance

- [CONTRIBUTING.md](CONTRIBUTING.md) — how to build, test, verify and contribute
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [SECURITY.md](SECURITY.md) — security model and how to report vulnerabilities
- [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) — stability levels per layer
- [docs/RELEASES.md](docs/RELEASES.md) — versioning and release process
- [docs/ROADMAP.md](docs/ROADMAP.md) — the milestone roadmap
- [rfcs/](rfcs/) — RFC process for architectural changes
- [docs/adr/](docs/adr/) — Architecture Decision Records
- [.github/ISSUE_TEMPLATE/](.github/ISSUE_TEMPLATE/) — issue templates
- [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md)

## License

[Apache License 2.0](LICENSE) — see the [LICENSE](LICENSE) file for details.

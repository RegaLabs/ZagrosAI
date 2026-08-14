# Contributing to Zagros

Thank you for considering a contribution. This project is young and fast-moving — read this before opening an issue or PR.

## Project status

Zagros is **experimental**. Milestones v0.1.0 through v1.0.0 are code milestones, each verified end-to-end, but public APIs and formats are not frozen. Expect breaking changes. Pin commits when building on top of it.

## Repository overview

- `packages/` — the shared libraries (domain, protocol, models, tools, harness, kernel, runtime, credentials, connectors, skills, mcp, acp, a2a). The kernel is transport-agnostic: the same code runs locally and on Cloudflare.
- `apps/` — runnables: `server` (local control plane), `runner` (executor that connects outward), `cloudflare` (Workers deployment), `web` (the PWA).
- `scripts/verify-*.mjs` — the milestone verification suites. A milestone is only "done" when its verify script passes end-to-end.
- `scripts/bench.mjs` — the reproducible load benchmark.

## Setup

Requirements: Node.js >= 20 (Node 22+ recommended), pnpm 9+.

```bash
pnpm install
pnpm -r --filter './packages/*' build
pnpm dev            # server on :8787 + web on :5173
```

Useful commands:

```bash
pnpm -r typecheck           # strict TS across the monorepo
pnpm -r test                # unit tests
pnpm verify                 # v0.1.0 end-to-end (server + runner + mocks)
pnpm verify:v1              # v1.0.0 gauntlet (phone-only + laptop-disconnect journeys)
node scripts/bench.mjs      # 20-task load benchmark
```

CI runs all ten verifies on every push (`.github/workflows/verify.yml`). A PR that breaks a verify script will not pass review.

## Coding conventions

- Strict TypeScript, no `any` (use `unknown` + narrowing), no unused imports or variables.
- ESM everywhere, `NodeNext` resolution, relative imports use `.js` extensions.
- **No code comments unless explicitly requested.** The code should read itself.
- No emojis in the UI or docs.
- The web app follows the project's design system: no nested `backdrop-filter`, no animated filters, opacity/transform-only transitions, `@supports` fallbacks, reduced-motion support.
- New features that touch the control plane should come with a verify-script section (or a new milestone script) proving the behavior end-to-end, not just a unit test.
- Backend logic lives in `packages/`; `apps/server` and `apps/cloudflare` are thin transport adapters. Do not put business logic in a transport.

## Branching and PRs

- Work on a feature branch: `git checkout -b feat/your-change`.
- Open a PR against `main` with a concise description: what changed, why, and how it was verified (which verify scripts pass).
- Small, focused PRs review faster. One concern per PR.

## Reporting bugs

Open an issue with the bug report template. Include:

- What you ran (command + relevant configuration)
- What you expected
- What happened (logs, task status, error text)
- The Zagros version or commit

## Design changes

Substantial architectural changes go through the RFC process (`rfcs/README.md`). Small decisions are recorded as ADRs (`docs/adr/`).

## Code of conduct

Be respectful. Harassment or abuse of any kind is not tolerated. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

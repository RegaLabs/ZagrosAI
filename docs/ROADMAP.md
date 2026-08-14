# Roadmap

The canonical roadmap is the file `Zagros — Zero-to-Hero Architecture and Roadmap.md` in the repository root. This page summarizes the milestone plan.

## Milestones

| Version | Theme | Status |
|---|---|---|
| v0.1.0 | Kernel — PWA chat, models, tools, Runner, MCP, durable tasks | Done (20 checks) |
| v0.2.0 | Always-on cloud — Cloudflare adapter, Workflows, D1/R2, push | Done (17) |
| v0.3.0 | Connected work — MCP OAuth, connectors, encrypted credentials, approvals | Done (26) |
| v0.4.0 | The computer — browser on Runners, screenshots, live view, pause/resume | Done (17) |
| v0.5.0 | Memory + skills — extraction with provenance, SKILL.md system | Done (18) |
| v0.6.0 | Any model, any harness — native drivers, fallbacks, ACP bridges | Done (6) |
| v0.7.0 | Routines — schedules, webhooks, retries, dead-letter, expiry | Done (16) |
| v0.8.0 | Multi-agent + A2A — delegation, parallel subtasks, Agent Cards | Done (18) |
| v0.9.0 | Hardening — injection defenses, secret redaction, signed skills, audit chain | Done (17) |
| v1.0.0 | Open Agent Operating System — phone-only + laptop-disconnect journeys | Done (15) |

## Beyond v1.0.0 (candidate themes)

These are candidate directions, not commitments:

- Stable protocol freeze and formal releases
- Community skill registry with signed installs
- Mobile push on Android/iOS via native wrappers (currently PWA)
- Performance work: context pruning, cheaper memory retrieval
- Federation: multiple Zagros deployments talking A2A

## How milestones get done

A milestone is complete when:

1. Its verify script (`scripts/verify-<version>.mjs`) passes end-to-end (real server, real HTTP/WS).
2. The web UI exposes the milestone's features with every control wired to its endpoint.
3. Typechecks, unit tests and the liquid-glass audit stay green.

## RFCs and ADRs

Architectural changes go through `rfcs/`; decisions are recorded in `docs/adr/`.

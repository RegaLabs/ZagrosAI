# Compatibility Policy

Zagros is experimental. This document states exactly what stability each layer has today and what a future stable 1.0 release will require.

## Stability levels

| Level | Meaning |
|---|---|
| **Stable** | Backwards-compatible. Breaking changes require a major version bump and a migration path. |
| **Experimental** | Works today but may change without notice. |
| **Unstable** | Interface exists but is expected to change. |

## Current status per layer

| Layer | Level | Notes |
|---|---|---|
| REST API (`/api/*`) | Experimental | Routes may be added; existing routes may change shape. Request bodies are validated with zod schemas in `@zagros/protocol`. |
| WebSocket event protocol | Experimental | Event shapes may change. |
| Runner protocol (`/ws/runner`) | Experimental | Message shapes may change; the runner and server ship in lockstep. |
| Task schema / task steps | Experimental | Storage migrations are additive (guarded `ALTER TABLE`), but fields may be renamed. |
| Skill format (`skill.yaml` + `SKILL.md`) | Experimental | The manifest schema may gain fields; unknown fields are tolerated. |
| Model driver interface (`ModelDriver`) | Experimental | The interface may change; provider drivers are adapters. |
| ACP client bridge | Experimental | Tracks upstream ACP versions. |
| A2A server/client | Experimental | Implements the core A2A surface (Agent Cards, `agent/get`, `agent/ping`, `message/send`). |
| MCP client | Experimental | Follows the MCP spec; server compatibility may vary. |
| Storage layout (SQLite / D1) | Experimental | New columns are added via guarded migrations; data is exportable via `/api/export`. |
| Environment variables | Experimental | `ZAGROS_*` variables may be renamed. |

## What a stable 1.0 will require

A future stable release must freeze and document:

1. The REST API surface and WS event shapes (versioned).
2. The Runner protocol.
3. The skill manifest format.
4. The `ModelDriver` interface.
5. The storage schema and migration rules.
6. The ACP/A2A/MCP integration levels.

Until then, treat every upgrade as a migration and pin commits.

## Vendor independence

Zagros is designed to never depend on a single provider:

- Models: any OpenAI-compatible endpoint, native Anthropic/Gemini/Cloudflare drivers, local inference, or ACP harness bridges.
- Cloud: Cloudflare is a runtime adapter behind the `Repos`/`ObjectStore` interfaces; a fully local deployment requires no cloud at all.
- Tools: MCP is the primary protocol; provider-native harnesses keep their own authentication.

No reverse-engineered authentication is a core feature and never will be.

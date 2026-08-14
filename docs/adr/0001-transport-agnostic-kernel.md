# ADR-0001: Transport-agnostic kernel

- Status: Accepted
- Date: 2026-08
- Superseded by: none

## Context

The project needs to run on a local Node process (SQLite, filesystem, WebSockets) and on Cloudflare Workers (D1, R2, Durable Objects). Duplicating the control plane per runtime would double every future feature's cost and let the two runtimes drift.

## Decision

All control-plane logic lives in `packages/kernel` and depends only on two storage interfaces (`Repos`, `ObjectStore` from `@zagros/runtime`), an event bus, and the shared `@zagros/*` packages. `apps/server` and `apps/cloudflare` are thin transport adapters that implement those interfaces (SQLite/D1, fs/R2) and expose HTTP/WS.

## Consequences

- Features are implemented once and verified on both runtimes by the same milestone verify scripts.
- Adding a new runtime (e.g., a container deployment) means implementing two interfaces, not porting a codebase.
- The cost is an indirection layer and async storage methods everywhere.

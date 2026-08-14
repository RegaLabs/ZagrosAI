# ADR-0002: Cloudflare as a runtime adapter, not a dependency

- Status: Accepted
- Date: 2026-08

## Context

Serverless execution is valuable for always-on work, but the project must be self-hostable and provider-independent (see COMPATIBILITY.md). The roadmap explicitly rejects `Zagros == Cloudflare`.

## Decision

Cloudflare Workers is the recommended zero-VPS reference deployment, implemented as a runtime adapter behind `Repos`/`ObjectStore` (D1/R2), Durable Objects for live sessions, and Workflows for scheduled work. No kernel code imports Cloudflare APIs; the local runtime is fully functional without it.

## Consequences

- Fully local mode requires no cloud account.
- Cloudflare limits (Free tier has no arbitrary Linux compute) are handled by the Execution Fabric: machine-required work routes to Runners.
- Adding or replacing a cloud provider is an adapter swap.

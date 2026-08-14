# Architecture Decision Records

ADRs record significant decisions so future contributors know why the architecture is the way it is. They are short, immutable records; corrections are new ADRs that supersede old ones.

| ADR | Decision |
|---|---|
| [ADR-0001](0001-transport-agnostic-kernel.md) | The kernel is transport-agnostic; runtimes are adapters |
| [ADR-0002](0002-cloudflare-as-runtime-adapter.md) | Cloudflare is an optional runtime adapter, never a dependency |
| [ADR-0003](0003-provider-auth-stays-in-provider-harnesses.md) | Provider authentication stays inside provider harnesses (ACP); never reverse-engineered |
| [ADR-0004](0004-tasks-as-durable-state-machines.md) | Tasks are persisted state machines, not fire-and-forget calls |

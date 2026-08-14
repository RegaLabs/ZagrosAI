# ADR-0004: Tasks as durable state machines

- Status: Accepted
- Date: 2026-08

## Context

Agents must survive browser refreshes, server restarts and machine loss. A fire-and-forget `runAgent()` call cannot do that.

## Decision

A task is a persisted state machine (queued -> running -> waiting_for_tool / waiting_for_approval -> verifying -> completed | failed | cancelled | expired | blocked). Every step and every tool call is persisted after each iteration; the task survives its executor. Runners reconnect outward, so the control plane never needs inbound ports.

## Consequences

- Tasks resume or fail cleanly across restarts; the UI can always show a task's true state.
- Side-effecting steps carry idempotency keys so recovery does not double-execute.
- The harness checkpoints via the same `Repos` interface on both runtimes.

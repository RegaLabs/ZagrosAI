# Security Policy

## Status

Zagros is **experimental and not externally audited**. Security boundaries exist and are verified by the v0.9.0 and v1.0.0 suites, but the project should not yet be used for sensitive or irreversible operations.

## Reporting a vulnerability

Do **not** open a public issue for security problems. Report privately:

- Open a GitHub Security Advisory against this repository, or
- Email the maintainers (address TBD — until then, open a private advisory).

Please include:

- The affected version/commit
- A minimal reproduction (config, commands, logs)
- The impact you observed

We aim to acknowledge reports within 72 hours and to respond with a fix or mitigation plan. Please do not disclose the issue publicly until we have addressed it.

## Security model

### The model does not control your permissions

- The policy engine is enforced outside the model: R0/R1 actions auto-run, R2/R3 actions require approval, and per-agent `denyTools`/`approvalTools` override everything.
- The model cannot bypass tool metadata (risk, idempotency, requirements).

### Prompt-injection defense

- The harness labels data boundaries: TRUSTED INSTRUCTIONS / USER REQUEST vs UNTRUSTED tool results, memory and skills.
- Instructions found inside untrusted data must never override policy, request secrets, or change permissions.
- apiKeys and OAuth tokens are collected and scrubbed (`[REDACTED]`) from tool results before they reach the model, and the persisted messages are redacted too.

### Credentials

- Credentials are encrypted at rest with AES-256-GCM; the key is derived (HKDF) from `ZAGROS_MASTER_KEY` (or `data/master.key` locally). The database never contains decryptable credentials by itself.
- Provider subscription logins stay inside the provider's own harness (ACP bridge). Zagros never scrapes cookies or calls undocumented private endpoints.
- MCP OAuth follows the standard flow; tokens are stored encrypted and refreshed automatically.

### Skills

- Skills declare permissions and required capabilities.
- When a public key is configured (`ZAGROS_SKILL_PUBLIC_KEY`), only signed, verified skills are trusted and injected into agent context. Untrusted skills are listed but never activated.

### Audit

- Every audit event is hash-chained (each event carries the hash of the previous), so tampering is detectable. The chain can be verified end-to-end.

### Network and execution

- The http tools enforce a domain policy (blocked/allowed lists).
- Filesystem tools are confined to the workspace root.
- Runners can wrap every shell command with a sandbox (`ZAGROS_SHELL_WRAPPER`).
- Task quotas and rate limits bound resource use.

## Supported versions

Only the current `main` branch is supported. There are no security releases yet; patches land on `main` and are announced in release notes (`docs/RELEASES.md`).

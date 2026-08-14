# ADR-0003: Provider authentication stays inside provider harnesses

- Status: Accepted
- Date: 2026-08

## Context

Users hold subscription-based logins for provider-native agents (ChatGPT for Codex, Claude subscriptions, Google accounts for Gemini CLI). Extracting those tokens and calling undocumented endpoints would be fragile and ethically dubious.

## Decision

Zagros never reverse-engineers consumer authentication. Subscription-backed provider agents are integrated through the provider's official harness via the ACP bridge (`packages/acp`, hosted on Runners): the provider CLI owns its authentication and its tool execution. API-key and documented OAuth flows are used for direct provider APIs.

## Consequences

- Laptop-off rule: a subscription login that lives on a laptop cannot run in the cloud; tasks fail with a clear message unless an always-on Runner holds the login.
- Direct API drivers (OpenAI, Anthropic, Gemini) are limited to what the provider officially documents.

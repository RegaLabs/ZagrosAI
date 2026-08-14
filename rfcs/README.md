# RFCs

RFCs describe architectural changes that affect the project's public surface or fundamental design. They exist to make decisions reviewable before code lands.

## Process

1. **Proposal** — copy `0000-template.md` to `rfcs/NNNN-name.md` and fill it in. Open a PR labeled `rfc`.
2. **Discussion** — the PR is the discussion thread. Anyone may comment.
3. **Decision** — maintainers approve or reject. An approved RFC is merged; its ADR(s) are written in `docs/adr/`.
4. **Implementation** — code lands in follow-up PRs referencing the RFC.

## When an RFC is needed

- Changes to the REST/WS/Runner protocols
- Changes to the skill format or the `ModelDriver` interface
- New runtime adapters or storage engines
- Anything that would break existing deployments

Small changes do not need an RFC — use an ADR entry instead.

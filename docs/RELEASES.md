# Releases and Versioning

## Status

Zagros does not yet have formal releases. The current state is the `v1.0.0` **code milestone** — every milestone from v0.1.0 to v1.0.0 is implemented and verified end-to-end, but the project remains experimental (see the README "Not the complete version" section).

## Version scheme

Versions follow `MAJOR.MINOR.PATCH`:

- `MAJOR` — breaking changes (protocol, API, storage or skill-format incompatible)
- `MINOR` — new features, backwards compatible
- `PATCH` — bug fixes

Until the project reaches a stable 1.0, MAJOR bumps may happen frequently.

## Milestones

The roadmap milestones (v0.1.0 ... v1.0.0) are tracked in [ROADMAP.md](ROADMAP.md). Each milestone has a verify script (`scripts/verify-*.mjs`) that must pass fully before the milestone is considered complete.

## Future stable release criteria

A stable 1.0 release requires, per [COMPATIBILITY.md](COMPATIBILITY.md):

- frozen REST/WS/Runner protocol surfaces (versioned),
- a frozen skill manifest format,
- a frozen `ModelDriver` interface,
- storage migration guarantees,
- an external security review,
- reproducible benchmarks in CI.

## Changelog

Keep a human-readable summary of user-visible changes per version. Format:

```text
## [Unreleased]

### Added
### Changed
### Fixed
### Security
```

## Release process (draft)

1. All verify scripts pass locally and in CI.
2. Bump versions across `packages/*` and `apps/*` (single `MAJOR.MINOR.PATCH`).
3. Update the changelog.
4. Tag the commit `vMAJOR.MINOR.PATCH`.
5. Publish packages (when publishing begins) and update deployment docs.

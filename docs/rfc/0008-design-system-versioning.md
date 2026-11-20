# RFC 0008: Design system versioning

- **Status:** Draft
- **Author:** owner
- **Date:** 2026-11-20
- **Related:** RFC 0001, RFC 0004

## Summary

`@mfe/ui` is a versioned design system shared through Module Federation as a **non-singleton**: every remote may run with its own compatible semver version, and several versions can live on one page. CSS classes and tokens carry a major prefix (`ds1-`), so two majors never fight over the same selectors.

## Motivation

Remotes are released independently (RFC 0004). A design system forced to one copy would make every remote upgrade in lockstep, which defeats independent releases. A copy per remote with no sharing wastes bytes and drifts silently.

## Goals / Non-goals

- Goal: a remote built against `@mfe/ui` 1.0.0 keeps working when the others move to 1.x (it reuses the newer compatible copy) or to 2.x (it loads its own 1.x copy).
- Goal: a breaking change cannot restyle remotes that did not opt in.
- Non-goal: theming, or more than `Button`, `Table` and `Field` for now.

## Proposal

- `packages/ui` has a real version (`1.0.0`) and a `CHANGELOG.md`.
- `federation.shared.ts` declares `'@mfe/ui': { singleton: false, requiredVersion: '^1.0.0' }`. With `singleton: false` each consumer gets the highest registered version that satisfies its range. Within a major that means one copy for everyone (verified: a frozen 1.0.0 release runs on the shell's 1.1.0); across majors the runtime falls back to the consumer's own bundled copy, so two copies load (verified: 1.0.0 next to 2.0.0, `loaded 2 times` in the inspector).
- Tokens are `--ds1-*` on `:root`; classes are `ds1-*`; components carry `data-ds` hooks. The CSS is imported by the components, so it travels with the shared chunk.
- Rule: a **breaking change** (removed or renamed prop, changed markup contract, changed token meaning) is a major bump, a new prefix (`ds2-`, `--ds2-*`) and a CHANGELOG entry. Minor and patch releases only add.
- The inspector Shared table shows a `Singleton` column and every loaded `@mfe/ui` version.

## Alternatives considered

| Option                                | Why not                                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `@mfe/ui` as a singleton              | One version for all remotes: breaks independent releases, one remote upgrade hits all.          |
| A bundled copy per remote, not shared | Duplicate code on every page and no signal when copies drift; sharing reuses a compatible copy. |

## Trade-offs and risks

- Two versions on one page mean two copies of the component code and CSS. Accepted: that is the price of independent upgrades.
- Unprefixed tokens or classes would leak between versions. Keep every ds name prefixed.
- Overlapping `:root` tokens from two majors are safe only because the prefix differs.

## Rollout

T22 in `docs/PLAN.md`: ship 1.0.0, move products and dashboard to it. The README "Design system versions" section walks through both cases: a compatible bump (one copy) and a major bump (two copies).

## Open questions

- None.

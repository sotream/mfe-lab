# RFC 0018: PR previews with a database branch

- **Status:** Accepted
- **Author:** mfe-lab
- **Date:** 2026-11-22
- **Related:** T43, `docs/deploy.md`, RFC 0013

## Summary

Every same-repo PR gets a public preview: shell, the remotes it changed and an API on its own Neon branch (a copy-on-write copy of production data). A sticky PR comment links to it; closing the PR deletes the Neon branch, the aliases and the preview deployments.

## Motivation

Deploys happen only after merge. A reviewer cannot click the change, and an API preview on the production database would let a PR write to real data.

## Goals / Non-goals

- Goal: a live, isolated, self-cleaning preview per PR, no new secrets or dependencies.
- Non-goal: previews for forks or Dependabot; preview of unchanged remotes (they use production).

## Proposal

`preview.yml` (see `docs/deploy.md`): Neon branch `preview/pr-<n>` (created from the default branch, reused, migrated on every push), preview deployments in the existing Vercel projects, aliased to `*-pr-<n>.vercel.app`. The API gets the branch URI as a deployment runtime env. The shell's `/api` rewrite is generated with the preview API URL at build time, so the browser stays same-origin and the API needs no CORS. Cleanup on close removes the branch, the aliases and the PR's preview deployments (found by the `pr` deploy metadata). Neon branches expire 14 days after the last sync (`expires_at`), a backstop for PRs that never close cleanly. Production secrets target production only; the preview API gets the branch URI and a per-run `JWT_SECRET`, and no `CRON_SECRET`.

## Alternatives considered

| Option                          | Why not                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| One shared preview database     | PRs with migrations clobber each other                                             |
| Vercel Git integration previews | Not installed on purpose; no database isolation; cannot rewrite per-PR remote URLs |
| Previews without DB isolation   | A PR could mutate production data                                                  |

## Trade-offs and risks

Neon free-tier branch cap (the comment says "preview unavailable"). The preview shares no secret with production (T48). Vercel deployment protection may block anonymous access to preview aliases. Back out by deleting `preview.yml`.

## Rollout

T43. Needs no new secrets.

## Open questions

- Should a PR that changes `packages/**` preview all remotes? It does, through `scripts/changed-apps.ts`.

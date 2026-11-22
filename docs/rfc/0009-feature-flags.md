# RFC 0009: Feature flags

- **Status:** Accepted
- **Author:** mfe-lab
- **Date:** 2026-11-20
- **Related:** [RFC 0006](0006-data-between-remotes.md), [RFC 0002](0002-sharing-auth-state.md)

## Summary

Runtime feature flags live in the API (a `flags` table). Remotes read them through their own TanStack Query client, and the shell inspector lets an admin toggle them. A toggle emits `flags:changed`, so a mounted remote refetches without a reload.

## Motivation

Turning a feature on or off should not need a rebuild or a new remote release. The lab also needs a safe way to make a remote fail on demand (error tracking demo).

## Goals / Non-goals

- Goal: boolean flags, changed at runtime, read by every remote independently.
- Goal: a remote keeps working when flags are unavailable.
- Non-goal: per-user targeting, percentages, history, a flag SDK.

## Proposal

**API.** Migration `002_flags.sql` creates `flags(name, enabled, description)` and seeds three flags with `ON CONFLICT DO NOTHING`: `dashboard.revenue` (on), `products.detailPage` (on), `products.crash` (off). `GET /flags` (any signed-in user) returns `{ name, enabled, description }[]` sorted by name. `PATCH /flags/:name` with `{ enabled: boolean }` is admin only: `403 forbidden`, `404 not_found` for an unknown name, `400 invalid_body` for a bad body.

**Client.** `@mfe/api-client` has `listFlags()` and `setFlag(name, enabled)`.

**Remotes.** Each remote has its own `src/flags.ts` with `useFlag(name, fallback)`. It reads the `['flags']` query of that remote's `QueryClient` (only when signed in) and returns the flag's value, or `fallback` while loading, on error, when signed out, or when the flag is missing. `useFlagsSync()` runs once under the `QueryClientProvider` and invalidates `['flags']` on `flags:changed`. Convention: a remote reads only flags with its own prefix (`products.*`, `dashboard.*`).

**Flags in use.** `dashboard.revenue` hides the Revenue by status section. `products.detailPage` turns product names into plain text. `products.crash` makes `ProductsContent` throw `products.crash flag is on` during render, which the shell `RemoteFrame` shows as its error fallback.

**Shell.** The inspector has a `Flags` section. It calls `listFlags` directly (the shell has no TanStack Query). Admins get an enabled checkbox per flag (`aria-label` = flag name); on change it calls `setFlag`, then `emit('flags:changed', { name, enabled })`. Other roles see the same checkboxes disabled. Signed out: `Sign in to see flags`.

**Events.** `flags:changed` `{ name, enabled }` is added to `EventMap` (RFC 0006 changelog).

## Alternatives considered

| Option                                    | Why not                                                  |
| ----------------------------------------- | -------------------------------------------------------- |
| Build-time env flags                      | Needs a rebuild; no runtime demo.                        |
| Shared flags store (federation singleton) | Breaks the "nothing new is shared" rule of RFC 0006.     |
| Shell passes flags as props               | Remotes would no longer work standalone.                 |
| Polling                                   | An event is enough; a toggle is always done in this tab. |

## Trade-offs and risks

- A toggle only reaches remotes mounted in the same tab; other tabs and users see it on the next mount.
- Each remote fetches `/flags` once per mount.
- Fallbacks are duplicated in the call sites. Safe default: a broken flag service leaves today's behaviour.

## Rollout

T23 in `docs/PLAN.md`.

## Open questions

- None.

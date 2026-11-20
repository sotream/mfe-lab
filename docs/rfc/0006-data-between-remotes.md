# RFC 0006: Data between remotes

- **Status:** Accepted
- **Author:** owner
- **Date:** 2026-11-20
- **Related:** RFC 0001, RFC 0002

## Summary

Each remote owns its server-state cache (its own TanStack Query `QueryClient`) and talks to other remotes only through a small typed event contract, `@mfe/events`, carried by `window` `CustomEvent`. UI state of the products remote lives in a Redux Toolkit store local to that remote. Nothing here is a federation singleton.

## Motivation

Remotes call plain `fetch` with hand-written loading and error state, and know nothing about each other. After a product is created, the dashboard's Products tile stays stale until a reload. The usual fixes (a shared query client, a global Redux store) couple the teams that MFEs exist to decouple.

## Goals / Non-goals

- Goal: per-remote caching, cross-remote sync through an explicit contract, visible in the inspector.
- Goal: remotes stay independently versionable and work standalone.
- Non-goal: a shared cache, a global store, RTK Query, any API change.

## Proposal

- **Per-remote `QueryClient`.** Products and dashboard each create their own client inside the exposed page (per mount) with `retry: false` and `refetchOnWindowFocus: false`, which keeps today's error and Retry behaviour. A user change remounts the page tree (keyed by user id), so a new user never sees an old cache. `@mfe/auth-store` is unchanged.
- **Events contract.** `packages/events` exports `EventMap`, `emit`, `on` and `onAny`. `emit('products:changed', { id, kind })` dispatches `mfe:products:changed` and a generic `mfe:*` carrying `{ name, detail, at }`. The bus is the DOM, so `@mfe/events` is deliberately not in `federation.shared.ts`: each remote can bundle its own copy.
- **Redux Toolkit local to products.** Client UI state (page, sort, search, dialogs) in a store created per page mount, never shared or exposed.
- **Inspector.** The shell subscribes with `onAny` at startup into an in-memory ring buffer of the last 20 events (`apps/shell/src/eventLog.ts`); the inspector shows it live. It resets on reload.

**Contract rule:** a new event means a change to `EventMap` plus a changelog line below.

## Alternatives considered

| Option                            | Why not                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Shared `QueryClient` singleton    | All remotes must agree on one react-query major; query keys collide; one team's defaults leak into another's. Hidden coupling. |
| Global Redux store across remotes | A state blob owned by nobody; remotes read each other's state.                                                                 |
| RTK Query next to TanStack Query  | Two server-cache libraries is the anti-pattern.                                                                                |

## Trade-offs and risks

- Each remote bundles its own copy of TanStack Query (about 13 kB gzip each) in exchange for independence.
- The cache lives per mount, so a remote refetches when it mounts again, as it does today. Upgrade path: a module-level client per remote.
- Invalidation across remotes is an explicit step (emit, then listen), not automatic. Events are only observed while a listener is mounted.

## Rollout

T17 `@mfe/events` and the inspector log; T18 TanStack Query and cross-remote invalidation; T19 Redux Toolkit in products.

## Changelog

- 2026-11-20: `products:changed` `{ id, kind }` (T17).
- 2026-11-20: products and dashboard use TanStack Query, one `QueryClient` per page mount and per user; products emits `products:changed` after a successful mutation, dashboard invalidates `['stats']` (T18).
- 2026-11-20: products UI state (page, sort, search, dialogs) moved to a Redux Toolkit slice in a store created per page mount and per user; not shared, not exposed (T19).
- 2026-11-20: `flags:changed` `{ name, enabled }`, emitted by the shell inspector after a flag is toggled; remotes invalidate their `['flags']` query (T23, RFC 0009).

## Open questions

- None.

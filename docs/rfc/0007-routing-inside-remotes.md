# RFC 0007: Routing inside remotes

- **Status:** Accepted
- **Author:** owner
- **Date:** 2026-11-20
- **Related:** RFC 0001, RFC 0002

## Summary

The shell owns the top-level paths and mounts a remote at `<name>/*`. The remote owns everything under that splat: its own `<Routes>` and relative links. This works because `react-router` is a shared singleton, so shell and remote use one router context and one history.

## Motivation

Until now a remote was a single screen. A real product has pages inside a remote (a list, then a detail). The shell should not have to learn them, and the back button, deep links and reloads must keep working.

## Goals / Non-goals

- Goal: `/products/5` opens the product detail page, from a click, a back button or a cold load.
- Goal: the remote still runs standalone on `:3001`, with the same routes.
- Non-goal: a route registry, or the shell sharing route definitions with remotes.

## Proposal

- The products remote adds a second expose, `./ProductsApp`: `index` renders the list, `:id` renders `ProductDetail`. `./ProductsPage` stays as it is and is still used on Home.
- The shell route is `products/*` and loads `ProductsApp` (`loadPage('products', 'ProductsApp')`). Home keeps `ProductsPage`.
- Links inside the remote are relative (`to="5"`, `to=".."`). On Home, where the remote is not the route owner, the list links to the absolute `/products/<id>`.
- `ProductsApp` owns one root (query client, Redux store, keyed by user) above its `<Routes>`, so list page, sort and search survive list -> detail -> back.
- Cold deep links: the shell dev server uses `historyApiFallback` and nginx uses `try_files $uri /index.html`, so `/products/5` serves the shell. Chunks load from the remote's own origin through `publicPath: 'auto'`, not relative to `/products/`.

## Alternatives considered

| Option                                    | Why not                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| The shell knows each remote's routes      | Couples the shell to remote internals; every new remote page needs a shell PR. |
| A router per remote (`MemoryRouter` etc.) | Two histories: the URL and the back button no longer match what is on screen.  |

## Trade-offs and risks

- The remote depends on the shell mounting it under a splat. Standalone mounts it under `/*`, which covers that.
- A remote on a different `react-router` major would not share the context. The version is pinned in the catalog and the library is a singleton.

## Rollout

T21 in `docs/PLAN.md`: one PR, with unit tests and the `E-nested-route` e2e.

## Open questions

- None.

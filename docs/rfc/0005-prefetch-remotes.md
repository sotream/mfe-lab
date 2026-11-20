# RFC 0005: Prefetch remotes on idle

- **Status:** Accepted
- **Author:** owner
- **Date:** 2026-11-20
- **Related:** RFC 0001, RFC 0004

## Summary

After the first render, when the browser is idle, the shell calls `preloadRemote` for both remotes (manifest, `remoteEntry.js`, expose chunks). A later navigation to a remote page finds everything in the browser cache.

## Motivation

RFC 0001 left one open question: should the shell prefetch remote entries on idle? Measure first. Without prefetch, the first visit to a remote page waits for manifest, entry and expose chunks in sequence.

## Goals / Non-goals

- Goal: decide with numbers; ship if the throttled median improves by 30% or more.
- Non-goal: per-route or hover prefetch, prefetch of shared chunks, a config switch.

## Method

- Production images: `docker compose up --build -d` (nginx serving builds), not dev servers.
- Scenario: log in at `/login?next=/inspector` (mounts no remote), wait 1 s, click the nav link `Products`, measure until the first `section[data-remote="products"] tbody tr` is visible.
- 10 runs per cell, each in a fresh browser context with an empty cache (Chrome via Playwright). Unthrottled, and Fast 4G through CDP `Network.emulateNetworkConditions` (latency 150 ms, 1.6 Mbps down, 750 kbps up).
- Timing is taken in the page: a capture-phase click listener records `performance.now()`, and a `requestAnimationFrame` loop records when the row is visible. A first attempt with Playwright's `waitFor` was discarded: its polling interval made A read a constant ~800 ms.
- Variant A: current code. Variant B: `prefetchRemotes()` on idle.

## Results

| Variant         | Network     | Median ms | p90 ms |
| --------------- | ----------- | --------- | ------ |
| A (no prefetch) | unthrottled | 333       | 348    |
| B (prefetch)    | unthrottled | 47        | 48     |
| A (no prefetch) | Fast 4G     | 1201      | 1208   |
| B (prefetch)    | Fast 4G     | 823       | 850    |

B is 86% faster unthrottled and 31.5% faster on Fast 4G. What remains in B is the products API call and render at 150 ms latency.

Request timing (run 1, relative to the click):

- A: products `mf-manifest.json`, `remoteEntry.js` and the expose js/css are requested only after the click (+32 ms manifest, then +36 ms unthrottled or +197 ms on Fast 4G).
- B unthrottled: both manifests at -1067 ms, products entry and expose js/css at -1063 ms, dashboard at -1062 ms; none after the click.
- B Fast 4G: manifests at -1034 ms, products entry and expose chunks at -856 ms, dashboard at -852 ms; all finished before the click.

## Decision

Ship B. `prefetchRemotes()` in `apps/shell/src/remotes.ts` runs once per page load, never throws (failures go to `console.warn`), and is called from `bootstrap.tsx` in `requestIdleCallback` (`setTimeout` fallback). It calls `preloadRemote` with `nameOrAlias`, `exposes` (`./ProductsPage`, `./DashboardPage`) and `resourceCategory: 'all'`. It does not call `registerRemotes`, so it uses whatever entry is registered and follows `setRemoteEntry` (RFC 0004).

`resourceCategory`: the default `'sync'` preloads only the expose's synchronous js/css; `'all'` also fetches its async chunks, which `loadRemote` would otherwise request after the click.

## Trade-offs and risks

- Prefetch also runs on `/login`, before sign-in. The remote assets are public static files, so nothing sensitive is fetched.
- The dashboard's bytes are fetched even if the user never opens it.
- The gain is measured on localhost with emulated throttling, and the Fast 4G margin over the 30% threshold is thin (31.5%).
- Click within the first moments after load, before idle, gets no benefit; it behaves like A.
- A version chosen in the inspector after the prefetch is not prefetched; that load behaves like A.

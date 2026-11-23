# RFC 0017: Remote registry, canary and kill switch

- **Status:** Accepted
- **Author:** mfe-lab
- **Date:** 2026-11-21
- **Related:** [RFC 0004](0004-versioned-remotes.md), [RFC 0005](0005-prefetch-remotes.md), [RFC 0009](0009-feature-flags.md), [RFC 0010](0010-error-tracking.md)

## Summary

The API keeps a small registry of remotes: an optional **canary** manifest URL with a percentage, and a **disabled** switch. The shell reads it at boot and decides per remote and per user: stable, canary or switched off. A canary that fails to load falls back to stable and reports it. None of this needs a shell redeploy.

## Motivation

The shell bakes each remote's manifest URL in at build time (RFC 0004). Changing which version users get, or switching a broken remote off, then means rebuilding and redeploying the shell. Real platforms put a runtime control layer in front of Module Federation for exactly this.

## Goals / Non-goals

- Goal: roll a new remote version out to a percentage of users, the same users every time.
- Goal: switch one remote off without touching the rest of the page.
- Goal: a broken canary costs users nothing.
- Non-goal: per-region rollout, gradual auto-ramp, server-side composition, an audit trail.

## Proposal

**Registry.** Migration `004_remote_registry.sql`: `remotes(name, canary_url, canary_percent 0..100, disabled, updated_at)`, seeded with `products`, `dashboard` and `orders` (no canary, 0%, enabled). `GET /registry` is public (the shell reads it before login) and sends `Cache-Control: public, s-maxage=5, stale-while-revalidate=60` to anonymous requests, so the Vercel CDN can answer without waking the function and the database (a cold start plus a Neon wake-up cost about 1.4 s); a request with `Authorization` gets `no-store` (Vercel never caches those), so a signed-in admin reads fresh state, and the inspector applies the `PATCH` response directly. `PATCH /registry/:name` is admin only; `canaryUrl` must be `https://` or `http://localhost:<port>` / `http://127.0.0.1:<port>`, with a path ending in `/mf-manifest.json`. `seed:reset` and the daily reseed put the registry back to stable.

**Stable stays build-time.** The registry only adds a canary and a switch. The stable URL is still the shell's baked-in manifest.

**Fail open.** The shell fetches `/registry` once at boot with a 2 s timeout, in parallel with the render. If it fails or times out, every remote resolves to stable, with no error banner; the inspector says "registry unavailable".

**Sticky buckets.** `bucket(userId, remote)` is FNV-1a 32-bit of `${userId}:${remote}`, mod 100, in `apps/shell/src/registry.ts`. A signed-in user is on the canary when `bucket < canaryPercent`. The hash is deterministic and the same in every browser, so a user keeps the same variant across reloads and devices; the remote name is in the hash, so one user is not first in line for every rollout. Anonymous users get stable.

**Resolution.** `resolveRemote(name, row, userId)` returns `{ variant, entry, bucket }`: `disabled` wins; then `canary` (URL set, signed in, bucket below percent); else `stable`. Each load of a remote re-resolves, so a change applies on the next load, not as a hot swap.

**Kill switch.** A disabled remote is never fetched: no manifest, no entry request. Its frame shows "<remote> is switched off right now" (DE: "ist gerade abgeschaltet") with no Retry, and the rest of the page keeps working. For visitors the switch takes effect within about a minute (CDN freshness 5 s plus up to 60 s stale-while-revalidate); an admin sees it at once. The idle prefetch (RFC 0005) skips disabled remotes and warms the resolved entry.

**Fallback.** A Module Federation runtime plugin (`fallbackPlugin.ts`) implements `errorLoadRemote`. If a remote on canary fails to load (manifest, entry or expose), the plugin re-registers stable with `force`, marks the remote as fallen back for the page session, reports `{ kind: 'load', build: 'canary', message: 'canary failed, fell back to stable: ...' }` (RFC 0010) and returns the stable module, so the frame renders stable without an error. A canary that hangs never reaches the plugin: `load()` gives it 5 s (`CANARY_TIMEOUT_MS` in `remotes.ts`), then falls back the same way and reports `canary timeout`. `load()` also waits at most 1 s for an idle prefetch still in flight before it re-registers a remote. At most one fallback per remote per page. A failure on stable behaves as before: frame error and Retry.

**Manual pick (RFC 0004).** The inspector's version select still wins for the session, over canary, fallback and the switch: it is a deliberate developer action.

**Inspector.** The Remotes table shows the variant (`stable`, `canary`, `fell back`, `off`) and the user's bucket. Admins edit canary URL, percent and the off switch; others see read-only values.

## Alternatives considered

| Option                      | Why not                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Edge Config / JSON on a CDN | The production answer (fast, no API in the path). Here the API already gives auth, reseed and one place to look. |
| Registry returns stable too | Boot would depend on the registry; today a dead registry changes nothing.                                        |
| Random split per page load  | A user would flip between versions on reload; a canary needs sticky users.                                       |
| Hot swap on change          | Replacing a mounted remote loses its state; the next load is enough for a lab.                                   |

## Trade-offs and risks

- The registry is public and cached at the CDN for seconds, so an API outage only costs the 2 s timeout once per page.
- Prod has no `/releases` (T30): a canary there must still be an allowlisted manifest URL (see Trust model). The demo is a broken canary at 100%: everyone stays on stable.
- Fallback is per page session; the next page load tries the canary again.
- Not done: per-region rollout, automatic ramp-up, server-side composition.

## Trust model

A canary manifest is code the shell executes in every signed-in user's page, so whoever can write `canary_url` can run script on the site. T46 closed this (review C1: any `https` origin was accepted; one stolen or misused admin token meant script injection).

- **Allowlist** (`deploy/canary.ts`, `isAllowedCanary`): `https:`, no user-info, path ending `/mf-manifest.json`, and the origin is one of the three production remote origins in `deploy/urls.json` or a PR preview host matching exactly `mfe-lab-(products|dashboard|orders)-pr-<digits>.vercel.app` (no port). Outside production, `http://localhost:<port>` is also accepted. The production API (`VERCEL_ENV=production`) and the production shell build (`VERCEL_ENV=production` at build time) refuse the preview hosts, so only previews accept them. Production means `NODE_ENV=production` in the API; the shell allows localhost only when its own stable URLs are on localhost, decided at build time.
- **One source, two checks.** The API rejects a bad URL on `PATCH /registry/:name` with `400 invalid_canary_url`. The shell runs the same function in `resolveRemote`: a registry row that fails it (written before the fix, or straight into the database) is ignored and the user gets stable. Running `migrate` also clears `canary_url` and `canary_percent` of any row that fails the check.
- **CSP as the second wall.** The shell sends `script-src 'self'` plus the exact remote origins (docs/deploy.md), so even an allowlist bug cannot load a script from another origin. Preview shells list their own preview remote origins; the wildcard `https://*.vercel.app` is not used, because anyone can host a script there.
- **Not covered:** a compromised remote origin (its Vercel project) is trusted by design; the allowlist is per origin, not per remote name.

## Rollout

T36 in `docs/PLAN.md`. Migration adds one table; with no canary and nothing disabled, behavior is unchanged.

## Open questions

- None.

# RFC 0010: Error tracking per remote

- **Status:** Accepted
- **Author:** mfe-lab
- **Date:** 2026-11-20
- **Related:** [RFC 0001](0001-module-federation-for-frontend.md), [RFC 0006](0006-data-between-remotes.md), [RFC 0009](0009-feature-flags.md)

## Summary

Every error is reported to the API with the remote it came from and that remote's build. The shell reports render and load failures through `RemoteFrame`; each remote and the shell install `window` handlers for the rest. An admin reads the table in the inspector.

## Motivation

With several independently deployed remotes, "something broke" is not enough: we need to know which remote and which build. `RemoteFrame` already hides a crash from the user, so without a report the crash would be invisible.

## Goals / Non-goals

- Goal: attribute each error to a remote and a build, with no external service.
- Goal: reporting never breaks the page, even with the API down.
- Non-goal: source maps, sampling, alerting, per-user data, a Sentry-like SDK.

## Proposal

**API.** Migration `003_errors.sql` creates `errors(id, remote, build, kind, message, stack, url, at)`. `POST /errors` needs no auth (a broken page may have no valid token): body `{ remote, build, kind: 'render' | 'load' | 'unhandled', message, stack?, url }`, returns `201 { id }`, `400 invalid_body` for a bad body. The server truncates `message` to 500 and `stack` to 4000 characters, sets `at`, and keeps the newest 1000 rows. `GET /errors?remote=` (newest 50), `GET /errors/summary` (`{ remote, count }[]`) and `DELETE /errors` (204) are admin only. `sendBeacon` with a `Blob` of type `application/json` sends a normal JSON content type, so no extra body parser is needed.

**`@mfe/telemetry`.** A package with no dependencies, bundled by each app and not shared through federation. `report(e)` adds `url: location.href` and posts to `/api/errors` with `navigator.sendBeacon`, falling back to `fetch` with `keepalive`. It never throws. The same `remote + kind + message` within 5 s is sent once, so a crash loop (Retry while `products.crash` is on) does not flood the table. `installGlobalHandlers({ remote, build, origin, ignoreOrigins })` listens to `error` and `unhandledrejection` and reports `kind: 'unhandled'`.

**Who reports what.**

| Source                         | Reported by                                     | `remote`  |
| ------------------------------ | ----------------------------------------------- | --------- |
| Render error inside a frame    | `RemoteFrame` `report` prop (shell passes it)   | the frame |
| Remote failed to load          | `RemoteFrame` `report` prop, `build: 'unknown'` | the frame |
| Unhandled error in a remote    | handler installed by that remote                | its name  |
| Unhandled error in the shell   | handler with the shell's origin                 | `shell`   |
| Anything else (3rd-party code) | catch-all handler, `origin: null`               | `unknown` |

`@mfe/ui` takes `report` as an optional prop, so it does not depend on `@mfe/telemetry` (1.1.0, additive).

**Attribution by origin.** Each remote file `src/telemetry.ts`, imported by the exposed page, installs a handler once per bundle with `origin` taken from the bundle's public path (`__webpack_public_path__`, `auto`: the URL the remote was loaded from; standalone, the page origin). An event belongs to a remote when its `filename` starts with that origin or its `stack` contains it. The shell installs a handler for its own origin plus the catch-all, which ignores the shell's and all remote origins. `import.meta.url` was not used: rspack rewrites it to a build-time file path.

**Inspector.** An admin-only `Errors` section: counts per remote, the newest 20 rows, `Refresh` and `Clear`. No live push.

## Alternatives considered

| Option                         | Why not                                                             |
| ------------------------------ | ------------------------------------------------------------------- |
| Hosted service (Sentry)        | External request at runtime; no value for a lab.                    |
| Share telemetry as a singleton | Nothing needs one copy; keeps the shared list as in RFC 0006.       |
| `@mfe/ui` imports telemetry    | Couples the design system to a service; an optional prop is enough. |
| Authenticated POST             | Errors before login or after token expiry would be lost.            |

## Trade-offs and risks

- **Known limit:** a cross-origin script error without `crossorigin` on the script tag reaches `window` as `"Script error."` with no filename and no stack. Module Federation loads remote scripts without `crossorigin`, so such errors cannot be attributed and land in `unknown`. Render and load errors do not have this limit, because React and the runtime catch them in the shell.
- `POST /errors` is public: anyone can fill the table. The 1000-row cap and truncation bound the damage; it is a lab.
- De-dupe is per bundle and per page load, in memory.

## Rollout

T24 in `docs/PLAN.md`.

## Open questions

- None.

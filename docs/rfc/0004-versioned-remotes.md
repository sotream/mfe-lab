# RFC 0004: Versioned remotes via manifest

- **Status:** Accepted
- **Author:** owner
- **Date:** 2026-11-20
- **Related:** RFC 0001

## Summary

A remote can be frozen into a release (a static folder next to the remote), and the shell can switch a remote between its live dev build and any release at runtime by changing only the manifest URL. The shell is not rebuilt.

## Motivation

RFC 0001 stamps builds but always loads the one live manifest. The point of federation is independent deployment, and that is only visible if two versions of a remote can coexist and the host can choose.

## Goals / Non-goals

- Goal: release a remote as `apps/<remote>/releases/<version>/`, switch to it from `/inspector`, see the build stamp change in the frame.
- Non-goal: a registry service, automatic rollout, semver negotiation, persisting the choice.

## Proposal

- **Release:** `pnpm --filter @mfe/<remote> release <version>` runs `scripts/release.ts`. It validates the version (`/^[0-9A-Za-z.-]+$/`), builds the remote with `MF_BUILD_VERSION=<version>` and `MF_RELEASE_DIR=releases/<version>` (read by `output.path`; `publicPath: 'auto'` so chunks resolve next to the manifest), and rewrites `releases/index.json` as `{ "versions": [...] }`, sorted by semver, else by string. `releases/` is gitignored.
- **Serve:** the remote dev servers serve `releases/` at `/releases/` with the existing CORS header.
- **Select:** `apps/shell/src/remotes.ts` keeps the selected manifest per remote in memory. `setRemoteEntry(name, url | null)` re-registers the remote with `force: true` and notifies subscribers; the next `loadPage(name)` fetches the new manifest. `null` returns to the build-time default.
- **UI:** the inspector's Remotes table has a `Use` select: `dev` plus the versions from `releasesUrl(name)`. A failed fetch offers only `dev`. A frame that mounts after the switch loads the selected version; mounted frames are not hot-swapped.

## Alternatives considered

| Option                            | Why not                                                          |
| --------------------------------- | ---------------------------------------------------------------- |
| Rebuild the shell with a new URL  | Defeats independent deployment.                                  |
| Persist the choice (localStorage) | Hidden state; a reload to the default is easier to reason about. |
| Registry service                  | Right for production, too much for a lab.                        |

## Trade-offs and risks

- A real setup would use CDN paths per version, a remote registry service that returns the manifest URL per environment, and a semver range in the host (for example "products ^1") resolved against it.
- Shared singletons: an old release was built against older `react` or `@mfe/auth-store` ranges. The host provides its own copy, so a release may run against a newer singleton than it was built with; the inspector shows the resulting versions and warnings.
- The selection is in memory only, like the token: a reload resets to `dev`.

## Rollout

Part of T12. No migration; the default behavior without a selection is unchanged.

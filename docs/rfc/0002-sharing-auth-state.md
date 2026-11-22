# RFC 0002: Sharing auth state between shell and remotes

- **Status:** Accepted
- **Author:** owner
- **Date:** 2026-11-18
- **Related:** RFC 0001

## Summary

The shell owns login. Remotes read the current user and token from a tiny shared package `@mfe/auth-store`, loaded as a federation singleton. Remotes never implement login and never persist tokens.

## Motivation

Without a shared store each remote would log in on its own or receive props from the shell, which couples contracts to the host. Shared singleton state is the simplest demonstration of cross-app runtime sharing.

## Goals / Non-goals

- Goal: one source of truth for `user`, `token`, `status` (`anonymous | loading | authenticated`).
- Goal: remotes re-render on login/logout without prop drilling.
- Non-goal: refresh tokens, SSO, cookie sessions, multi-tab sync.

## Proposal

```ts
// packages/auth-store
type AuthState = { user: User | null; token: string | null; status: Status };
login(email, password): Promise<void>;
logout(): void;
useAuth<T>(selector: (s: AuthState) => T): T;   // React hook
getToken(): string | null;                       // for the API client
```

- Implementation: about 60 lines on `useSyncExternalStore`, no dependency. (If it grows, zustand is the fallback.)
- Declared `singleton: true` (`eager` left at its default, false), the same `requiredVersion` everywhere (from `federation.shared.ts`). If a remote got its own copy, state would silently split; the inspector checks that exactly one instance is loaded.
- Token lives **in memory** only. Page reload re-authenticates via login form (accepted for the lab). Trade-off documented in README.
- API client (`@mfe/api-client`) reads `getToken()` per request and calls `logout()` on 401. It always calls the relative `/api/...`; every dev server proxies `/api` to the API on `:4000` (prefix stripped), so requests are same-origin and no CORS setup is needed.
- Roles come from `user.role`; UI hides actions, API enforces. Remotes use `useAuth(s => s.user?.role)`.

## Alternatives considered

| Option                     | Why not                                                     |
| -------------------------- | ----------------------------------------------------------- |
| Props from shell           | Couples every remote to the host's prop contract.           |
| `window` custom events     | Works, but untyped and invisible to the inspector.          |
| Each remote logs in        | Duplicated sessions, bad UX.                                |
| localStorage token         | XSS exposure; also hides the sharing lesson behind storage. |
| Redux/zustand as singleton | Heavier than needed for three fields.                       |

## Trade-offs and risks

- Singleton mismatch splits state silently. Mitigation: the inspector checks that `@mfe/auth-store` is loaded once, and an e2e test asserts that a login in the shell is visible in the products remote.
- In-memory token means reload logs out. Acceptable here; a cookie session would be the production answer and needs its own RFC.

## Public demo admin is read-only in production

The demo accounts are public, so on the live deployment the API refuses the changes that affect every visitor (registry, flags, error log, orders, product delete) with `403 demo_read_only`. The API decides and tells the client through `user.demo` in the login and `/auth/me` responses; the shell shows a "Demo admin" chip and disables those controls, and remotes use the shared helpers `canWrite` and `canDestroy` from `@mfe/auth-store`. Previews, dev and tests are unlocked.

## Rollout

T5. Tests: store unit tests, route guard, e2e in T9 (`E-shared-auth`).

## Open questions

- Keep the store in a package of its own or expose it from the shell? Package chosen for standalone remote development; revisit if it causes duplicate instances.

## Changelog

- 2026-11-18: T5: store implemented as specified; added `@mfe/api-client` and the `/api` dev-server proxy; `@mfe/auth-store` joined the shared singleton list.
- 2026-11-20: T8: the inspector lists `@mfe/auth-store` in the shared table and shows `loaded once`.
- 2026-11-20: T9: e2e `E-shared-auth` logs in as viewer and editor in the shell and checks that the products remote shows `Add product` only for the editor. Status set to Accepted.
- 2026-11-22: T47: demo admin read-only in production, `demo` flag on the user, `canWrite`/`canAdmin`/`canDestroy` in the store.

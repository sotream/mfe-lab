# RFC 0002: Sharing auth state between shell and remotes

- **Status:** Draft
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

- Implementation: ~30 lines on `useSyncExternalStore`, no dependency. (If it grows, zustand is the fallback.)
- Declared `singleton: true`, `eager: false`, same `requiredVersion` everywhere. If a remote got its own copy, state would silently split; the inspector checks that exactly one instance is loaded.
- Token lives **in memory** only. Page reload re-authenticates via login form (accepted for the lab). Trade-off documented in README.
- API client reads `getToken()` per request and calls `logout()` on 401.
- Roles come from `user.role`; UI hides actions, API enforces. Remotes use `useAuth(s => s.user?.role)`.

## Alternatives considered

| Option | Why not |
|---|---|
| Props from shell | Couples every remote to the host's prop contract. |
| `window` custom events | Works, but untyped and invisible to the inspector. |
| Each remote logs in | Duplicated sessions, bad UX. |
| localStorage token | XSS exposure; also hides the sharing lesson behind storage. |
| Redux/zustand as singleton | Heavier than needed for three fields. |

## Trade-offs and risks

- Singleton mismatch splits state silently. Mitigation: inspector check, e2e test asserting login in shell is visible in both remotes.
- In-memory token means reload logs out. Acceptable here; a cookie session would be the production answer and needs its own RFC.

## Rollout

T5. Tests: store unit tests, route guard, e2e in T9.

## Open questions

- Keep the store in a package of its own or expose it from the shell? Package chosen for standalone remote development; revisit if it causes duplicate instances.

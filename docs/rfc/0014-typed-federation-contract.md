# RFC 0014: Typed federation contract

- **Status:** Accepted
- **Author:** mfe-lab
- **Date:** 2026-11-21
- **Related:** [RFC 0001](0001-module-federation-for-frontend.md)

## Summary

What each remote exposes lives in one file, `federation.contract.ts` at the repo root. The remotes generate their rspack `exposes` from it and type-check their modules against it; the shell takes its remote names and module names from it. A wrong module name or a module without `buildVersion` fails `pnpm typecheck`.

## Motivation

`dts: false` left the contract implicit. The shell loaded `${name}/${module}` with `module: string`, so a typo or a removed expose compiled and failed only in the browser. The hand-written `remotes.d.ts` was imported by nothing and checked nothing.

## Proposal

`federation.contract.ts` exports `exposes` (remote to module names, `as const`), the derived `RemoteName` and `ExposedName<R>`, `ExposedModule` (`default` component, `buildVersion: string`) and `exposesMap(remote)`, which builds the rspack map `./<Name>` to `./src/<Name>.tsx`.

- **Provider:** each remote's `rspack.config.ts` uses `exposesMap`. `src/exposes.check.ts` imports every exposed module and `satisfies Record<ExposedName<R>, ExposedModule>`, so a missing export, a missing `buildVersion` or an uncovered contract name fails typecheck.
- **Consumer:** `loadPage<R>(name: R, module?: ExposedName<R>)` in the shell. `<Remote name="products" module="DashboardPage" />` does not compile. The default module of a remote is the first name in its list.
- `@mfe/ui` keeps its own looser `RemoteModule` (`buildVersion` optional): ui must not depend on the contract.
- The file has no react import (the repo root has no react types), so `ExposedModule` takes the component type as a parameter and the shell narrows it to `ComponentType`.

## Alternatives considered

| Option                      | Why not                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| MF `dts` type generation    | The remote zips its types and the consumer build downloads them: the shell build needs running or deployed remotes. |
| An `@mfe/contracts` package | One small file is enough; a package adds a workspace, a version and a build for no gain.                            |

## Consequences

Changing an expose is a contract change in one file; both sides fail typecheck until they agree. Old `/releases/*` builds are not re-checked, so the runtime frame still handles a missing module.

## Update (RFC 0016): module kinds

The contract now also has `kinds` (remote to `react` or `mount`) and the types `MountContext` and `MountModule`. `exposes.orders = ['OrdersApp']` is a `mount` module: `{ mount(el, ctx), buildVersion }`. `exposesMap` maps a `mount` remote's names to `./src/<Name>.ts`. `loadPage` takes only `react` remotes and `loadMount` only `mount` remotes, so a wrong kind fails typecheck.

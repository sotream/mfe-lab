# RFC 0016: Framework-agnostic remotes and CSS isolation

- **Status:** Accepted
- **Author:** mfe-lab
- **Date:** 2026-11-21
- **Related:** [RFC 0002](0002-sharing-auth-state.md), [RFC 0008](0008-design-system-versioning.md), [RFC 0012](0012-locale-across-remotes.md), [RFC 0014](0014-typed-federation-contract.md)

## Summary

The shell can mount a remote that is not React. A second module kind, `mount`, is `{ mount(el, ctx): () => void; buildVersion }`. The first such remote is `orders` (Vue 3.5, port 3003). It renders inside an open Shadow DOM, so no global style reaches it and none of its styles leak out. The React remotes keep light-DOM rendering and get a checked scoping rule instead.

## Motivation

Two questions come up in every micro frontend project: can the teams use different frameworks, and how do styles stay apart? Until now every remote was React and shared the page's CSS by convention only.

## Goals / Non-goals

- Goal: mount a remote written in another framework with no extra runtime in the shell.
- Goal: keep the frame (label, build stamp, Retry, error report) for every remote kind.
- Goal: CSS isolation that is real for the new kind and checked for the old.
- Non-goal: sharing Vue (only `orders` uses it), versioned releases of `orders`, SSR.

## Proposal

### The `mount` kind

`federation.contract.ts` lists each remote's exposes and its kind (`kinds`). `react` modules keep `{ default, buildVersion }`. `mount` modules export:

```ts
type MountContext = { locale: 'de' | 'en'; onError(error: unknown): void };
type MountModule = { mount(el: HTMLElement, ctx: MountContext): () => void; buildVersion: string };
```

`mount` returns the unmount function. The context is plain data and callbacks, with no framework types. `exposes.orders = ['OrdersApp']`, `kinds.orders = 'mount'`. Provider side: `apps/orders/src/exposes.check.ts` `satisfies Record<ExposedName<'orders'>, MountModule>`. Consumer side: `loadPage` accepts only `react` remotes and `loadMount` only `mount` remotes (`RemoteOfKind<K>`), so loading a remote as the wrong kind fails typecheck.

The shell adapter is `mountAdapter(name, module)` in `apps/shell/src/MountAdapter.tsx`. It returns a `RemoteFrame` page module whose component mounts into a host `div` in `useEffect` and returns the unmount as cleanup, so a route or remote change unmounts. A synchronous throw from `mount` is caught by the frame's error boundary (error state, Retry, a `render` report). `ctx.onError` sends a `render` report to `@mfe/telemetry` with the remote name and build.

Locale: the shell passes the current locale once. The remote follows `locale:changed` itself, so a language switch relabels in place and nothing remounts. The effect does not depend on the locale.

### What a non-React remote may import

- `@mfe/auth-store` main entry is framework-free (state, `subscribe`, `getState`, `getToken`, `login`, `logout`). The React hook is `@mfe/auth-store/react`. It stays a shared singleton, so Vue and React read the same token.
- `@mfe/api-client`, `@mfe/events`, `@mfe/telemetry` have no framework import.
- Not the React entry of `@mfe/ui`. `orders` formats with `Intl` directly (`src/format.ts`, the same formats as RFC 0012) and imports only `@mfe/ui/base.css` on its standalone page.

Checked by building: `apps/orders/dist` has no `react-dom`, no `react/jsx-runtime`, and the manifest `shared` list has only `@mfe/auth-store`.

### Shadow DOM inside `mount`

`OrdersApp.mount` attaches an open shadow root to `el`, appends a `<style>` with the component CSS (imported as text with `?raw`) and a container, and mounts the Vue app into the container. Nothing is added to `document.head`.

| Crosses the boundary                                    | Does not                                           |
| ------------------------------------------------------- | -------------------------------------------------- |
| Custom properties (`--ds1-*` tokens), so it looks right | Selectors from global CSS (`table`, `th`, resets)  |
| Inherited properties (`font-family`, `color`, `lang`)   | `@font-face` is document-wide, so fonts still work |
| Events that bubble and are composed                     | `:focus-visible` and `box-sizing` from `base.css`  |

So the remote re-declares what it needs from `base.css` (focus ring, box sizing) in its own CSS. `getByRole`, Playwright locators and axe pierce open roots, so tests and a11y checks still work. Trade-offs: no global theme override by selector (tokens only), forms and focus across the boundary need care, and a page-level `Ctrl+F` and screen reader flow are unaffected.

### Scoping rule for light-DOM React remotes

Every selector in a remote's own CSS (`apps/products/src/**/*.css`, `apps/dashboard/src/**/*.css`) starts with that remote's prefix class (`.products…`, `.dashboard…`) or `[data-remote="<name>"]`, also inside `@media` and `@container`. No bare element, universal or `:root` selector. Shared `@mfe/ui` CSS is exempt: it is a versioned, prefixed design system (RFC 0008). Violations fixed with no visual change: `.product-back`, `.product-name`, `.product-readings` became `.products-…`, and `.standalone-bar` and `.standalone-title` became `.products-standalone-…` and `.dashboard-standalone-…`.

This does not isolate them: a global `table th { border: 7px solid red }` still hits products. The rule only stops a remote from styling others. That is the honest trade-off against Shadow DOM, and the e2e demonstrates both.

## Alternatives considered

| Option                                           | Why not                                                                                                                                                                      |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web Components (custom elements) as the contract | Needs registration and attribute/property plumbing for locale and errors, and gives the shell no unmount or error hook. `mount(el, ctx)` is the same idea with less surface. |
| single-spa lifecycles                            | Another runtime and its own routing model next to Module Federation and React Router, for one remote.                                                                        |
| An iframe                                        | Real isolation but separate auth, no shared token, no shared layout, awkward a11y.                                                                                           |
| Shadow DOM for the React remotes too             | React portals (dialogs), the `@mfe/ui` global CSS and shared singletons would all need rework. The scoping rule is enough there.                                             |
| CSS Modules / hashed class names                 | A bundler convention that a remote can still break; a plain prefix rule is checkable by reading the file.                                                                    |

## Trade-offs and risks

- Two UI frameworks in one page: Vue (~35 KB gz) is paid only when `/orders` loads.
- `orders` has no versioned releases: the inspector lists it with the `dev` entry only, and `release.ts` is not wired for it.
- `GET /orders` carries `product_id` only, so `orders` joins names and prices from the first 100 products. An API join would be cleaner; not done here.
- Back out: remove `orders` from the contract and the shell route; the React remotes are unaffected.

## Rollout

T35 in `docs/PLAN.md`: auth-store split, the `orders` remote with its wiring (deploy, size budget, compose, e2e server), and this RFC.

## Open questions

- Should `mount` get a `update(ctx)` for props other than locale? Not until a second field changes at runtime.

# Plan

Each task = one branch = one PR = one squash commit. Read `docs/BRIEF.md`, `AGENTS.md` and the RFCs first. Tasks list dependencies; tasks without a dependency between them can run in separate worktrees.

```
T0 ─┬─ T1 ── T2 ── T3 ───────┐
    ├─ T4 ── T5 ──┬─ T6 ─────┼── T8 ── T9
    │             └─ T7 ─────┘
    └─ (T4 needs T0 only; T5-T7 need T3 for real data, can start on mocks)
```

## T0 Scaffold monorepo

- pnpm workspace (`apps/*`, `packages/*`), Node 26 `.nvmrc`, TS base config, ESLint flat config, Prettier, root scripts (`dev`, `build`, `lint`, `typecheck`, `test`, `seed`).
- `.github/workflows/ci.yml`: install, lint, typecheck, test, build.
- Empty package skeletons so workspaces resolve.
- **Done when:** `pnpm i && pnpm lint && pnpm typecheck` green.

## T1 API: db, migrations, seed (needs T0)

- `apps/api`: Fastify app factory `buildApp({ dbPath })`, `better-sqlite3`, SQL migrations in `migrations/*.sql` applied on start, `/health`.
- `pnpm seed`: deterministic data from BRIEF (scrypt (`node:crypto`) hashes for users).
- **Done when:** seed twice is idempotent (reset flag), tests cover migration + seed counts.

## T2 API: auth (needs T1)

- `POST /auth/login`, `GET /auth/me`, JWT 15 min, role guard decorator `requireRole(...)`.
- Tests: good login, bad password, expired/invalid token, role denied.

## T3 API: products, orders, stats (needs T2)

- CRUD per BRIEF with zod schemas, pagination (`?page&limit`), sort, search on products. `GET /stats`.
- OpenAPI via `@fastify/swagger` at `/docs` (cheap, useful for remotes).
- Tests per endpoint, role matrix test.

## T4 Shell + Module Federation host (needs T0)

- `apps/shell` Rspack config with `ModuleFederationPlugin` as host, routes `/`, `/products`, `/dashboard`, `/inspector`, `/login`.
- `packages/ui`: `RemoteFrame` (error boundary + Suspense + colored frame + label with name/port/version), basic layout CSS.
- Remotes declared in one `remotes.ts` (URL from env, defaults to localhost ports).
- Works with remotes as stubs ("hello from products").
- **Done when:** shell shows two framed slots; stopping a remote shows fallback, not a white screen.

## T5 Shared auth store + login (needs T4; real API from T2)

- `packages/auth-store` singleton shared by shell and remotes (see RFC 0002). Login page in shell, token in memory, logout. (No `/auth/me` on load: the token is in memory only per RFC 0002, so after a reload there is nothing to restore and the user logs in again.)
- Route guard for protected routes. Typed API client in its own package `packages/api-client`; dev servers proxy `/api` to the API.
- Tests: store logic, guard.

## T6 Products remote (needs T5, T3)

- `apps/products` exposes `./ProductsPage`: table with search/sort/pagination, create/edit dialog, delete confirm. Actions hidden by role.
- Runs standalone on `:3001` too (own `index.tsx` with fake login) so it can be developed alone.
- Tests for form validation and role gating.

## T7 Dashboard remote (needs T5, T3)

- `apps/dashboard` exposes `./DashboardPage`: stat cards, orders-per-day chart (plain SVG or `recharts` if already needed, prefer SVG), orders by status.
- Standalone on `:3002`. Tests for data mapping.

## T8 Federation inspector + visual polish (needs T6, T7)

- `/inspector` page: remotes table (name, URL, version from manifest, status up/down with live ping), shared deps table (name, required vs loaded version, singleton), "how to break this" hints.
- Build stamp injected per app (`__BUILD_VERSION__`) shown in each frame.
- **Done when:** all six visual points in BRIEF are demonstrable.

## T9 E2E, README, RFC sync (needs T8)

- Playwright smoke: login, both remotes visible, kill-remote fallback (simulated by aborting requests to :3001), viewer cannot see "Add product".
- README with 3-command start, mermaid architecture, screenshots/GIF. Update RFC statuses to `Accepted`, fix any drift.
- CI runs Playwright headless.

## T11 Native Federation comparison RFC

- **Goal:** record how Native Federation compares with Module Federation 2 for this repo, with sourced facts, a migration-cost estimate and the criteria for switching. Docs only, no code.
- **Done when:** `docs/rfc/0003-native-federation-comparison.md` is `Accepted` (decision: stay on MF2), indexed in `docs/rfc/README.md`, and linked from the README.

## T12 Versioned remotes

- `pnpm --filter @mfe/<remote> release <version>` freezes a build into `apps/<remote>/releases/<version>/` and updates `releases/index.json`. Dev servers serve `releases/`. The inspector gets a `Use` column to switch a remote between `dev` and a release by manifest URL, with no shell rebuild (RFC 0004).
- **Done when:** after releasing products 1.0.0 and 1.1.0, switching products to 1.1.0 in `/inspector` makes Home show `build 1.1.0`, and switching back to `dev` restores the dev stamp.

## T13 Dependabot

Goal: weekly grouped dependency update PRs via `.github/dependabot.yml`, with no Renovate app.

- **Done when:** the YAML parses, and the README "Dependencies" section describes the process.

## T10 Docker + compose

- **Goal:** `docker compose up --build` runs the whole lab: nginx serves shell (3000), products (3001) and dashboard (3002) from their builds, and the API runs behind `/api/` on each origin. The DB lives in a named volume.
- **Done when:** :3000 has a working login with both remotes; `docker compose stop products` makes only the products frame fall back, and `start` plus Retry recovers; `/inspector` shows `loaded once`; images build from a clean clone.

## T14 E2E for version switching

- **Goal:** Playwright covers runtime version switching of the products remote. A global setup freezes two releases (`0.0.1-e2e`, `0.0.2-e2e`) and a global teardown removes them, so the spec runs on any checkout.
- **Done when:** `pnpm e2e` passes with the version-switching spec (`E-versions`: each release shows `build <version>` on Home, `dev` shows the dev stamp), and afterwards `apps/products/releases` holds no `*-e2e` leftovers.

## T15 E2E against Docker images

- **Goal:** `pnpm e2e:docker` (`E2E_TARGET=docker`) runs the e2e specs against the compose stack instead of the dev servers. Release fixtures and `E-versions` are skipped there, since nginx serves no `releases/`. Local only.
- **Done when:** `pnpm e2e:docker` passes (5 passed, 1 skipped) and afterwards no containers run and the ports are free; default `pnpm e2e` is unchanged.

## T16 Prefetch remotes on idle

- **Goal:** the shell prefetches both remotes on idle after the first render, decided by measurement (RFC 0005).
- **Done when:** with the compose stack, the first click on `Products` after 1 s idle takes at least 30% less time on Fast 4G than without prefetch (measured 1201 to 823 ms), and the products entry and expose chunk requests happen before the click.

## T17 Typed events and inspector log

- **Goal:** `@mfe/events` is a typed contract over `window` CustomEvent for cross-remote messages (not a federation singleton). The shell keeps the last 20 events in memory and the inspector shows them live in an `Events` table (RFC 0006).
- **Done when:** evaluating `window.dispatchEvent(new CustomEvent('mfe:*', {detail:{name:'products:changed',detail:{id:1,kind:'updated'},at:Date.now()}}))` on `/inspector` adds a `products:changed` row with its payload; `@mfe/events` is absent from `federation.shared.ts`.

## T18 TanStack Query and cross-remote invalidation

- **Goal:** products and dashboard fetch through TanStack Query (own `QueryClient` per page mount and per user, bundled in each remote, not shared). Products emits `products:changed` after a successful create, update or delete; the dashboard invalidates its `stats` query on it (RFC 0006).
- **Done when:** on Home, adding a product in the products frame moves the dashboard `Products` tile from N to N+1 without a reload, and deleting it moves it back; `@tanstack/react-query` is absent from `federation.shared.ts`; existing products and dashboard tests pass unchanged.

## T19 Redux Toolkit for the products UI state

- **Goal:** the products page keeps its UI state (page, sort, order, search, open dialogs) in a Redux Toolkit slice `productsUi`, in a store created per page mount and per user, local to the products remote (RFC 0006).
- **Done when:** products behaviour is unchanged and all existing tests pass unedited; `@reduxjs/toolkit` and `react-redux` are absent from `federation.shared.ts`; two stores created by `makeStore()` share no state.

## T20 Docs

- **Goal:** the README reads in two minutes: pitch and infographic first, then quick start, "Things to see" with a screenshot each (the six brief points plus versions, events and cross-remote sync), data-flow diagrams, an RFC index, and an accurate command for every task. Screenshots are refreshed at 1280x900.
- **Done when:** `docs/img/architecture.svg` (under 60 KB, explicit background) renders without overlapping text; the README has the sequence diagram and the state-ownership flowchart; `docs/screenshots/` holds 1 to 8 plus `9a`/`9b`, each at most 300 KB; `pnpm lint && pnpm typecheck && pnpm test` pass.

## T21 Nested routes inside the products remote

- **Goal:** the products remote owns its sub-routes: the shell mounts it at `products/*` and the remote serves the list (`index`) and a product detail page (`:id`) with relative links (RFC 0007). Home keeps `ProductsPage`, with names linking to `/products/<id>`.
- **Done when:** clicking a product name opens `/products/<id>` with its details, the back button returns to the list with the same page and sort, a cold load of `/products/<id>` works (after login), `:3001/5` shows the detail standalone, and `pnpm lint && pnpm typecheck && pnpm test` pass.

## T22 Versioned design system

- **Goal:** `@mfe/ui` gets a real version (1.0.0), a changelog, `ds1-` tokens and three components (`Button`, `Table`, `Field`), shared as a non-singleton so remotes can run different compatible versions (RFC 0008). Products and dashboard use the components; the inspector shows a `Singleton` column.
- **Done when:** products and dashboard render `data-ds` components with unchanged roles and texts, the three `mf-manifest.json` list `@mfe/ui` 1.0.0 with `singleton: false`, the README "Design system versions" walkthrough works, and `pnpm lint && pnpm typecheck && pnpm test` pass.

## T23 Feature flags

- **Goal:** runtime flags in the API (`002_flags.sql`, `GET /flags`, admin `PATCH /flags/:name`), read by remotes with `useFlag(name, fallback)` and refreshed by the `flags:changed` event; an inspector `Flags` section lets an admin toggle them (RFC 0009).
- **Done when:** as admin, unchecking `dashboard.revenue` in the inspector removes the Revenue by status section on Home and checking it brings it back; `products.detailPage` off makes names plain text; `products.crash` on makes the products frame show its error fallback; viewers see disabled checkboxes; `pnpm lint && pnpm typecheck && pnpm test` pass.

## T24 Error tracking per remote

- **Goal:** errors are reported to the API (`003_errors.sql`, `POST /errors`, admin `GET /errors`, `GET /errors/summary`, `DELETE /errors`) with the remote and its build, from `RemoteFrame` (`report` prop) and from `@mfe/telemetry` window handlers in the shell and each remote; an admin-only inspector `Errors` section lists them (RFC 0010).
- **Done when:** as admin, checking `products.crash` makes the products frame show `products is unavailable` while the dashboard still renders, and after `Refresh` the inspector Errors table has a row with Remote `products` and Kind `render`; `@mfe/telemetry` is absent from `federation.shared.ts`; `pnpm lint && pnpm typecheck && pnpm test` pass.

## T25 Visual redesign

- **Goal:** one dark "Console" look across shell, products and dashboard, owned by `@mfe/ui` 1.2.0 (tokens `--ds1-*`, `base.css`, self-hosted OFL fonts): a frame bar that shows each remote's name, port and build, readings instead of cards, an inspector with a readings strip, and 30 unique lab-hardware product names in the seed (RFC 0008).
- **Done when:** every colour and font family is declared only in `packages/ui/src/tokens.css`; the three apps emit the `.woff2` files and make no request outside localhost; the Home frame bars sit level; `@mfe/ui` is 1.2.0 with a changelog entry and `requiredVersion` stays `^1.0.0`; the seed has 30 unique product names; roles, labels and routes are unchanged apart from the copy listed for T25; `pnpm lint && pnpm typecheck && pnpm test` pass.

## T26 Accessibility across remotes

- **Goal:** an ownership contract for page-level accessibility, WCAG 2.2 AA structure: the shell sets route titles, moves focus to the `h1` after navigation, renders the skip link and one live region; remotes own their subtree, start headings at `h3` and announce through `a11y:announce`; `@mfe/ui` 1.3.0 adds `Table` `label` and the frame `h2` (RFC 0011). `eslint-plugin-jsx-a11y` and `@axe-core/playwright` guard it.
- **Done when:** each top-level route has its title and the product detail sets its own; after a client navigation focus is on the page `h1`; the skip link is the first tab stop and focuses `main`; each page has one `h1`, frame names are `h2` and remote headings `h3`; the chart label is a summary and bars are not focusable; creating, saving and deleting a product and toggling a flag are announced in the shell's live region; after a failed Retry focus stays on Retry; `E-a11y` finds no serious or critical axe violation on the main pages; `@mfe/ui` is 1.3.0 with a changelog entry and `requiredVersion` stays `^1.0.0`; `pnpm lint && pnpm typecheck && pnpm test` pass.

## T27 German market

- **Goal:** the lab reads as a product for the German market: German UI by default for German browsers with an EN switch in the top bar, EUR gross prices, German date, number and time formats, German seed names, and Impressum and Datenschutz pages. The shell owns the locale (`lang` plus `locale:changed`), each app owns its messages, `@mfe/ui` 1.4.0 holds the formatters (RFC 0012).
- **Done when:** a browser with `de-DE` gets `<html lang="de">`, the German nav, titles and `674,28 €`; the switch changes every app in place without a reload, keeps the route and persists the choice in `localStorage['mfe-lab:locale']`; the product detail shows `inkl. 19 % MwSt.`; the price input accepts `674,28` and `674.28`; dates, chart axis and times follow the locale; the seed has 30 German names with `Drucksensor` first; `/impressum` and `/datenschutz` work signed out and are linked from the footer; `E-a11y` stays green in EN; `@mfe/ui` is 1.4.0 with a changelog entry and `requiredVersion` stays `^1.0.0`; `pnpm lint && pnpm typecheck && pnpm test` pass.

## T28 Semantic HTML

- **Goal:** the rendered DOM says what things are: a labelled `nav` that holds only the four links, named tables, dates as `<time>`, row headers, and a `search` landmark. `@mfe/ui` 1.5.0 renders the `Table` `label` as a visually hidden `<caption>` (RFC 0011).
- **Done when:** `header` holds the wordmark, `nav` (`Hauptnavigation` / `Main`, one list of four links), the language group and the user block; every table has an accessible name; products and detail dates, dashboard table dates and inspector times are `time` elements with a machine `dateTime`; the SKU, dashboard date and inspector Remotes, Shared and Flags name cells are `th scope="row"` and header-row `th` have `scope="col"`; the products search sits in `search`; `@mfe/ui` is 1.5.0 with a changelog entry and `requiredVersion` stays `^1.0.0`; `E-a11y` stays green; `pnpm lint && pnpm typecheck && pnpm test` pass.

## T29 Postgres for the API

- **Goal:** the API runs on Postgres, ready for Neon in production. Dev and tests use PGlite (Postgres in WASM, in-process, no Docker), compose runs `postgres:17`. One SQL dialect everywhere (RFC 0013). `DATABASE_URL` replaces `DB_PATH`.
- **Done when:** `openDb` takes `postgres://`, `pglite:memory` or `pglite:<dir>`; migrations 001-003 are Postgres SQL tracked in `schema_migrations`, and `pnpm --filter @mfe/api migrate` applies them; every response keeps its shape (numbers are numbers, timestamps are ISO with `Z`, `enabled` is boolean); search is case-insensitive for non-ASCII (`wägezelle` finds `Wägezelle`); unique and foreign-key violations are 409 with no DB detail; `seed:reset` restarts ids at 1; `better-sqlite3` is gone; compose has a `db` service and the API waits for it; `pnpm lint && pnpm typecheck && pnpm test` pass, and `E-smoke` stays green.

## T30 Vercel hosting prep

- **Goal:** every app can be deployed to Vercel as its own project and the API runs as a Vercel Function against Neon. Nothing is deployed here; T31 adds the accounts, `deploy.yml` and the first deploy (`docs/deploy.md`).
- **Done when:** `deploy/urls.json` and `node scripts/vercel-config.ts` generate the four committed `apps/*/vercel.json`; the static apps rewrite `/api/:path*` to the API, fall back to `/index.html`, send CORS (remotes), `no-store` on `mf-manifest.json` and `remoteEntry.js`, and `immutable` only on content-hashed files; the shell `build.env` has both production manifest URLs; the API has a Vercel entry that never listens or migrates and never loads PGlite; `GET /cron/reseed` is 404 without `CRON_SECRET`, 401 without the bearer token, and reseeds (3/30/60) with it; `docs/deploy.md` and the RFC 0013 hosting note exist; `pnpm lint && pnpm typecheck && pnpm test` pass.

## T31 Provision and deploy from Actions

- **Goal:** a live demo at `https://mfe-lab.vercel.app`. Provisioning and every deploy run in GitHub Actions; no secret value reaches a laptop, chat or log.
- **Done when:** `scripts/provision.ts` (plain `fetch`, idempotent) creates or finds the Neon project and the four Vercel projects and sets the API env vars without printing or rotating secrets, and fails naming the real domain if a production domain differs from `deploy/urls.json`; `provision.yml` (manual) runs it, migrates, seeds and checks 3 users; `deploy.yml` deploys on green CI for `main` (or by hand) in the order api, remotes, shell, only the apps `scripts/changed-apps.ts` selects, then smoke-checks the live URLs; the api `vercel.json` has `regions: ["fra1"]`; actions are pinned by SHA and the Vercel CLI by exact version; `docs/deploy.md` and the README live-demo link are in; `pnpm lint && pnpm typecheck && pnpm test` pass. No PR previews.

## T32 Live polish after the first deploy

- **Goal:** the live site shows where each remote really lives, and no dead config stays.
- **Done when:** `RemoteFrame` takes an optional `origin` (label as is; else `:port`; else none) and `@mfe/ui` is 1.6.0 with a changelog entry; the shell passes `remoteOrigin(<current manifest URL>)` (`:<port>` on localhost, else the hostname) and follows the version selected in the inspector; the home lead has no port in EN and DE; the generated shell `vercel.json` has no `build.env` and `docs/deploy.md` says the URLs come from `deploy.yml`; `pnpm lint && pnpm typecheck && pnpm test` pass.

## T33 Typed federation contract

- **Goal:** a wrong or removed expose fails at typecheck, not in the browser (RFC 0014).
- **Done when:** `federation.contract.ts` is the only list of exposed modules; both remotes generate `exposes` from it and `src/exposes.check.ts` makes a missing export or `buildVersion` a type error; the shell's `loadPage` and `Remote` accept only module names of the given remote; `apps/shell/src/remotes.d.ts` is gone; built manifests expose the same names as before; RFC 0014, RFC 0001 and `docs/architecture.md` are updated; `pnpm lint && pnpm typecheck && pnpm test` pass.

## T34 Performance budgets

- **Goal:** a slower bundle or a slower first screen fails a check instead of going unnoticed, and unchanged files are cached for good (RFC 0015).
- **Done when:** JS and CSS of all three apps are named `[name].[contenthash:16]` (`remoteEntry.js`, manifests and `index.html` stay fixed) and releases still switch in e2e; generated `vercel.json` and the nginx template mark hashed js/css/woff2 `immutable`; `perf-budget.json` holds `initialJsGzip`, `totalJsGzip` and `cssGzip` per app and `node scripts/size-budget.ts` (run by CI after `pnpm build`) exits 1 naming any metric over budget; `scripts/vitals.ts` measures LCP, CLS and time-to-remotes on Fast 4G and the `vitals` job in `deploy.yml` fails over budget after `smoke`; RFC 0015, `docs/deploy.md` and the README are updated; `pnpm lint && pnpm typecheck && pnpm test` pass.

## T35 Vue remote, framework-agnostic contract and CSS isolation

- **Goal:** the React shell mounts a Vue 3.5 remote, `orders` (`:3003`), through a framework-agnostic `mount(el, ctx)` contract, and it renders in a Shadow DOM; the React remotes follow a checked CSS scoping rule (RFC 0016).
- **Done when:** `federation.contract.ts` has `kinds` and the `MountModule` and `MountContext` types, `exposes.orders` is `['OrdersApp']`, and loading a remote as the wrong kind fails typecheck; the shell route `/orders` (nav Orders / Bestellungen) shows a labelled frame with a table, status filter, pagination, loading, empty and error states, DE/EN switching without remount, and a refetch on `products:changed`; the table is inside an open shadow root and `document.head` gets no orders style; `@mfe/auth-store` main entry has no `react` import and `useAuth` lives in `@mfe/auth-store/react`; `apps/orders/dist` contains no React and its manifest shares only `@mfe/auth-store`; every selector in the products and dashboard CSS starts with the remote's prefix class; `orders` is wired into `deploy/urls.json`, the generated `vercel.json`, `changed-apps.ts` (deploy order api, products, dashboard, orders, shell), `deploy.yml` (matrix, `MF_ORDERS_URL`, smoke), `perf-budget.json`, compose and the e2e servers; RFC 0016 is added and RFC 0014, README, `docs/architecture.md` and `docs/tour.md` are updated; `E-a11y` stays green with axe scanning `/orders`; `pnpm lint && pnpm typecheck && pnpm test` pass.

## T36 Remote registry, canary and kill switch

- **Goal:** change which version of a remote users get, and switch a remote off, without redeploying the shell; a failing canary falls back to stable (RFC 0017).
- **Done when:** migration `004_remote_registry.sql` and `GET /registry` (public, `no-store`) and `PATCH /registry/:name` (admin, validated) exist and `seed:reset` clears them; the shell resolves each remote from the registry (sticky FNV-1a bucket, canary, disabled) and fails open to stable when the registry is down; a disabled remote is never fetched and its frame shows a localized switched-off state; a `errorLoadRemote` runtime plugin falls back from a failing canary to stable once per page and reports it; the inspector shows variant and bucket and gives admins canary URL, percent and off controls; RFC 0017 is added and RFC 0004, RFC 0010, `docs/api.md`, README and `docs/tour.md` are updated; `pnpm lint && pnpm typecheck && pnpm test` pass.

## T37 Skeleton loading states

- **Goal:** every loading state is a skeleton with the final layout's size, so content swaps in without a jump (RFC 0011, loading states).
- **Done when:** `@mfe/ui` has `Skeleton`, `Table` `loading` and `RemoteFrame` `fallback` (shimmer off under `prefers-reduced-motion`); the shell frames, products list and detail, dashboard, orders (Vue, own skeleton in its shadow root) and the inspector tables show skeletons with a visually hidden `role="status"` text and `aria-busy`; the height of the frame bodies and tables before and after the data differs by at most 4 px and `clsHome` drops; `pnpm lint && pnpm typecheck && pnpm test` pass.

## T38 Custom select

- **Goal:** a styled, accessible select that looks the same in the React shell and the Vue remote and is never clipped by a scroll region (RFC 0011).
- **Done when:** `@mfe/ui/select-core` holds `keyAction`, `typeahead` and `placePopup` with no framework import; `@mfe/ui` 1.9.0 has `Select` and `@mfe/ui/select.css`, and orders has `DsSelect.vue` on the same core and CSS; the inspector "Use" select and the orders status filter use them (APG select-only combobox, popup in the top layer, flips above near the viewport bottom); no new dependency and no budget raised; RFC 0011 and the `@mfe/ui` changelog are updated; `pnpm lint && pnpm typecheck && pnpm test` pass.

## T39 Middle truncation with a tooltip

- **Goal:** long values (the inspector manifest URLs) show one line with the ellipsis in the middle and the tail visible; the full value is in an accessible tooltip.
- **Done when:** `@mfe/ui` 1.10.0 has `MiddleTruncate` and `Tooltip` (`@mfe/ui/tooltip.css`, top layer via `placePopup`); the Remotes table fits the panel at 1440 px in EN and DE without a horizontal scrollbar, the headers read Stable manifest, Canary manifest and Canary % with keyboard-reachable hints; the tooltip opens on hover and focus and closes on Escape; inspector layout shift stays under 0.01; no new dependency and no budget raised; RFC 0011 and the changelog are updated; `pnpm lint && pnpm typecheck && pnpm test` pass.

## Later (not now)

Nothing planned.

## T40 Logo mark, favicon and lockup

- **Goal:** one brand mark: flask = lab, shell body plus two remotes (cool, amber = loaded at runtime), tab lip with the amber hyphen of `mfe-lab`.
- **Done when:** `packages/ui/brand/` (favicon.svg with a dark-mode media query, favicon-32.png, apple-touch-icon.png, icon-512.png) is copied unhashed to every app's `dist/` and linked from every `index.html`; the shell header and login wordmark show the mark before the text with the accessible name unchanged; README shows `docs/img/logo.svg` / `logo-light.svg`; the brand files do not match the immutable cache rule; no budget raised.

## T41 Compact Remotes table and Details dialog

- **Goal:** the inspector Remotes table has 5 two-line columns (Remote, Manifest, Build, Use, Rollout) and fits from 1024 px up; the full values and the admin registry form move to a Details dialog.
- **Done when:** no horizontal scroll from 1024 px in EN and DE, for admin and viewer, with long canary URLs; Details (button or a click on the row) opens a native `<dialog>` with the full URLs and Copy, the build, variant, bucket, status and the manifest in use; admins edit canary URL, percent and Off there and Save through `updateRegistry`; Escape closes and focus returns to the Details button; inspector layout shift stays under 0.01; no new dependency and no budget raised.

## T42 Standalone h1 and tighter CLS budget

- **Goal:** every remote opened on its own URL has one visible `h1` naming the page; the CLS budgets match what is measured.
- **Done when:** products (list and detail), dashboard and orders standalone each show exactly one `h1` ("Products", "Dashboard", "Orders"; DE "Produkte", "Dashboard", "Bestellungen") and are axe-clean; inside the shell the remotes render no `h1` and the shell keeps the only one (RFC 0011); `perf-budget.json` has `clsLogin` and `clsHome` at 0.02 with a line in the RFC 0015 budget log; no new dependency and no size budget raised.

## T43 PR previews

- **Goal:** every same-repo PR gets a live stack (shell, changed remotes, API on its own Neon branch) and a sticky comment; closing the PR cleans up (RFC 0018).
- **Done when:** `preview.yml` deploys preview (never `--prod`) builds under `*-pr-<n>.vercel.app` aliases, skips forks and Dependabot, and its cleanup job deletes the Neon branch `preview/pr-<n>` and the aliases; the shell's `/api` rewrite reaches the preview API; smoke signs in as the demo admin and sees all three frames; the sticky comment lists the apps with `preview` or `production`, the branch, the commit and the smoke result and reads "Preview removed" on close; `docs/deploy.md` and RFC 0018 are added; no new dependency; `pnpm lint && pnpm typecheck && pnpm test` pass.

## T44 README as a case study

- **Goal:** a reviewer who opens the repo for a minute sees what is unusual, can try it live in two minutes, and can read what was left out on purpose.
- **Done when:** the README says three remotes (two React, one Vue) and its numbers match `perf-budget.json`, `size-budget` and the last vitals run; it has a "Try it in 2 minutes" box, a PR previews bullet, RFCs 0012-0018 in the table and a "Deliberately not done" section whose items each cite an existing RFC; the tour has the new screenshots; `docs/deploy.md` says Vercel Authentication is off on the five projects; no new dependency.

## T45 Architecture diagram refresh

- **Goal:** the first image in the README shows the lab as it is now.
- **Done when:** `docs/img/architecture.svg` says "three remotes", shows `orders` (Vue 3.5, `mount(el, ctx)`, Shadow DOM, only `@mfe/auth-store` shared), the registry read (`GET /registry`: stable, canary, off), the Orders nav link, and the API with Postgres (Neon in prod, PGlite in dev); it renders without overlapping or clipped text at 880 px and at its natural size; the README alt text and the first diagram in `docs/architecture.md` match; no new dependency.

## T46 Close canary script injection, security headers, bounded telemetry

- **Goal:** only our own remote origins can serve a canary; the shell and the API send basic security headers; `POST /errors` cannot be used to fill the table with huge rows (review C1, M2).
- **Done when:** `PATCH /registry/:name` answers `400 invalid_canary_url` for any URL that is not `https`, has user-info, does not end in `/mf-manifest.json`, or whose origin is not a production remote or an exact `mfe-lab-<app>-pr-<n>.vercel.app` host (localhost only outside production); `resolveRemote` ignores such a row from the database and loads stable; `migrate` clears existing bad canaries; the shell (Vercel config and nginx) sends a CSP with `default-src 'self'`, exact remote origins and `frame-ancestors 'none'`, plus `nosniff` and `Referrer-Policy`; remotes send `nosniff`; the API sends `nosniff`, `no-store` on authenticated requests and `404 { error: 'not_found' }` for unknown routes; `POST /errors` has a 16 KB body limit, `message` ≤ 2000, `stack` ≤ 8000, `url` ≤ 2000 and http(s) only, else 400; RFC 0017 has a Trust model section and `docs/deploy.md` lists the headers; no new dependency.

## T48 Deploy and preview pipeline hardening

- **Goal:** a main commit is never skipped by a deploy, previews cannot touch production secrets, and closing a PR leaves nothing behind.
- **Done when:** `ci.yml` cancels only pull_request runs; `deploy.yml` diffs from the last successful deploy (all when none), runs weekly as a catch-up and only from main when dispatched; production secrets target production only and previews get `-e` `JWT_SECRET` and no `CRON_SECRET`, with the DB guard before `alias set`; cleanup steps are all `always()` and also remove the PR's deployments; Neon branches expire after 14 days; the preview comment only edits one by `github-actions[bot]`; Dependabot auto-merge is an allowlist; `NEON_API_KEY` only on steps that use it; `docs/deploy.md` and RFC 0018 updated; no new dependency.

## T47 Demo lockdown and login hardening

- **Goal:** the public demo admin cannot change things that affect every visitor on the live site, and login resists brute force.
- **Done when:** with `VERCEL_ENV=production` the demo admin and editor get `403 demo_read_only` on registry, flag, errors-delete, order and product-delete writes and `/auth/me` returns `user.demo: true`; the shell shows a "Demo admin" chip and the Details dialog, flag toggles, errors clear and product delete are disabled with a note; login is limited to 10 per minute per IP, unknown emails cost the same time as known ones, emails match case-insensitively, a `JWT_SECRET` under 32 bytes refuses to start in production, the daily reseed also resets flags and clears errors; `@fastify/rate-limit` is the one new dependency; `pnpm lint && pnpm typecheck && pnpm test` pass.

## T49 Bugs from the review and code hygiene

- **Goal:** fix the review's functional bugs and tidy the code.
- **Done when:** `/stats` sums in bigint and product `price_cents` (max 100_000_000), `stock` (max 1_000_000) and order `qty` (max 10_000) are bounded, so over the limit is 400 and never 500; the products search survives list, detail and Back; a canary that has not loaded in 5 s falls back to stable (`fell back`) and `load()` waits for the idle prefetch for at most 1 s; the API pool logs idle errors instead of crashing; the inspector does not fetch switched-off remotes (status `off`) and the idle prefetch warms the entry the signed-in user resolves to; product and order updates use `returning *` (a concurrent delete is 404); a remote's error is reported once, as that remote; shell-only `[role='alert']` styling, Retry focus on first error only, one Orders fetch per status change, locale read at mount time, one HintTh announcement, one locale subscription; German flag descriptions, `dev (lokal)`, build prefix, error kind and `copyOf`; the footer uses `BuildStamp`; locked inputs look disabled and the demo chip is neutral; dead code and `ponytail:` comments removed or rewritten; the API image runs as `node`, base images pinned by digest and a `docker` Dependabot ecosystem; no new dependency; `pnpm lint && pnpm typecheck && pnpm test` pass.

## T50 Docs accuracy pass

- **Goal:** README, `docs/` and the RFCs say what the code does after the review fixes (T46 to T49).
- **Done when:** the daily reset, `/orders` guard, three-remote prefetch, `buildVersion` exports, orders locale, `onRequest` auth, the 404 shape, login timing and the write upper bounds, `MF_ORDERS_URL`, the per-path CORS and CSP headers on Vercel against nginx, and an expand/contract rule for migrations are in `docs/`; RFCs 0005, 0009, 0010, 0015, 0016 and 0017 are corrected in place with dated update notes where a decision changed (vitals failing the deploy run, canary timeout); `AGENTS.md` and `docs/BRIEF.md` say the repo is public and has three remotes; Dependabot ignores `path-to-regexp` majors (pinned to 6.1.0 to match Vercel's `headers[].source` parser, see #56); the docs link test covers `docs/api.md`, `docs/deploy.md` and `docs/testing.md`; no code change.

## T51 Shared rate-limit store

- **Goal:** the rate limits hold across serverless instances instead of per warm instance.
- **Done when:** `@fastify/rate-limit` uses a Postgres store (`rate_limits`, migration 006; one atomic upsert per request) with the same limits (login 10/min per IP, writes 60/min per user, `POST /errors` 30/min per IP); keys are hashed, never raw IPs; a failing store allows the request and logs a warning; expired rows are pruned on about 1% of calls; `RATE_LIMIT=off` is unchanged (ignored in production); no new dependency; `pnpm lint && pnpm typecheck && pnpm test` pass.

## T52 Dashboard CSS headroom

- **Goal:** `dashboard.cssGzip` back under 90% of its budget without raising it and without a visual change.
- **Done when:** the dashboard build emits the `@mfe/ui` styles (tokens, ds1, frame) once, not once per chunk group, so `dashboard.cssGzip` is at most 6451 bytes (budget 7168 unchanged); before and after screenshots of the dashboard standalone and inside the shell at `/dashboard` (EN and DE, 1440 and 390) are pixel-identical apart from the build stamp text; `pnpm lint && pnpm typecheck && pnpm test` pass; no new dependency.

## T54 Env-provisioned login and cron diagnostics

- **Goal:** login no longer depends on the reseed for env-provisioned accounts; cron auth failures are logged without secrets.
- **Done when:** a login for the env-configured email (case-insensitive) with all env vars set creates or updates that row from env before the normal login path, through the same helper `seed()` uses; no other email creates a row; a 401 at `/cron/reseed` logs a warning with only presence flags, lengths and a truncated user agent, never any part of a secret; `pnpm lint && pnpm typecheck && pnpm test` pass; no new dependency.

## T55 README banner with the mark

- **Goal:** the README opens with one banner that carries the mark and shows the current three remotes.
- **Done when:** the separate logo block above the banner is gone; `docs/img/banner.svg` has the mfe-lab mark before the wordmark (amber hyphen), its description and shell illustration show products, dashboard and orders (Vue), and the stack line names Vue; the banner renders without clipping or overlap at 880 and 1280 px; `logo.svg` and `logo-light.svg` stay for other uses; `pnpm lint && pnpm test` pass; no new dependency.

## T56 Shared role labels

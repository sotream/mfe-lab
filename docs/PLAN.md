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

## Later (not now)

Nothing planned.

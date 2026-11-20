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

## Later (not now)

Nothing planned.

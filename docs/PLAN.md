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

## Later (not now)

Nothing planned.

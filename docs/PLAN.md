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

## Later (not now)

Dockerfile + compose, Native Federation variant for comparison RFC, versioned remotes via manifest, Renovate/Dependabot.

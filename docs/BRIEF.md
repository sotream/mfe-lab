# Brief: mfe-lab

## Goal

Small private learning repo that **shows Federated Micro Frontends visually**. One shell app loads two independently built and served remote apps at runtime via Module Federation. A tiny API with SQLite gives real auth and CRUD, so the remotes do real work.

Not a product. A teaching lab: every design choice must make the federation boundaries visible and easy to explain in an interview.

## What the owner must see in the browser

1. Shell on `:3000` with nav, login, and layout.
2. Two remotes mounted inside the shell, each with a **visible frame**: colored border, label with remote name, port, build version/timestamp. You see where the shell ends and a remote begins.
3. Stop one remote dev server: the shell stays alive, the slot shows an error-boundary fallback ("products is unavailable"), the rest works.
4. Change something in a remote, rebuild only that remote: the shell shows the change after reload, no shell rebuild.
5. Shared singleton proof: a "Federation inspector" page lists shared deps (react, react-dom, react-router) with version and "loaded once" status.
6. Login in the shell, remotes know the user (shared auth store, not duplicated).

## Scope

| Piece                     | Tech                                                                                       | Port |
| ------------------------- | ------------------------------------------------------------------------------------------ | ---- |
| `apps/shell` (host)       | React 19, TS, Rspack + Module Federation 2 (`@module-federation/enhanced`), react-router 8 | 3000 |
| `apps/products` (remote)  | same stack; exposes `./ProductsPage`                                                       | 3001 |
| `apps/dashboard` (remote) | same stack; exposes `./DashboardPage` (stats cards + small chart)                          | 3002 |
| `packages/auth-store`     | tiny store (zustand or own 30 lines), singleton shared via federation                      | n/a  |
| `packages/ui`             | minimal shared components: `RemoteFrame`, `Button`, `Table`; plain CSS, no UI lib          | n/a  |
| `apps/api`                | Fastify, TS, `better-sqlite3`, JWT (`@fastify/jwt`), zod validation                        | 4000 |

Data: SQLite file `apps/api/data/app.db` (gitignored), created by migration, filled by `pnpm seed`.

- `users` (id, email, password_hash, role: admin|editor|viewer)
- `products` (id, sku, name, price_cents, stock, created_at)
- `orders` (id, product_id, qty, status: new|paid|shipped, created_at)

Seed: 3 users (`admin@lab.test`, `editor@lab.test`, `viewer@lab.test`, password `lab12345`, documented in README as demo-only), ~30 products, ~60 orders. Deterministic (seeded RNG).

API:

- `POST /auth/login`, `GET /auth/me`
- `GET/POST /products`, `GET/PATCH/DELETE /products/:id` (write: admin, editor)
- `GET /orders`, `POST /orders`, `PATCH /orders/:id`
- `GET /stats` (counts, revenue by status, orders per day, used by dashboard)
- `GET /health`

Roles: viewer reads only; editor writes products; admin everything. UI hides actions by role, API enforces.

## Non-goals

No SSR, no Next.js, no real deploy/CDN, no Docker (maybe later), no i18n, no design system beyond a few components, no payments, no refresh tokens (short JWT in memory is enough, README notes the trade-off).

## Quality bar (product-company style)

- Feature by feature, tests in the same change.
- API: Vitest + Fastify `inject`, in-memory SQLite for tests.
- Frontend: Vitest + Testing Library for components with logic; one Playwright smoke test (login, see both remotes, kill-remote fallback).
- ESLint + Prettier + `tsc --noEmit` in CI; GitHub Actions workflow file included.
- One PR per task in `PLAN.md`, squash merge, conventional commit titles.

## Docs deliverables

- `README.md`: what, how to run in 3 commands, screenshots/GIF of the 6 visual points, architecture diagram (mermaid).
- `docs/rfc/`: RFC process with template and two real RFCs (see directory). Builders keep RFCs in sync when a decision changes.
- `docs/PLAN.md`: task groups for builders.

## Definition of done

`pnpm i && pnpm seed && pnpm dev` starts everything; all six visual points work; CI green; README has screenshots; RFC 0001 and 0002 status `Accepted` and match the code.

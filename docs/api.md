# API

Postgres, chosen by `DATABASE_URL` ([RFC 0013](rfc/0013-postgres-for-the-api.md)): `postgres://...` (Neon needs `sslmode=verify-full`), `pglite:memory`, or `pglite:<dir>`. Empty means local PGlite in `apps/api/data/pg` (gitignored; relative dirs resolve against `apps/api/`). Migrations in `apps/api/migrations/*.sql` run on start (not when `NODE_ENV=production`), each in one transaction, tracked in `schema_migrations`. Run them by hand with `pnpm --filter @mfe/api migrate`.

```bash
pnpm --filter @mfe/api migrate   # apply pending migrations, print the version
pnpm seed         # seed if empty, otherwise prints "already seeded"
pnpm seed:reset   # wipe and reseed (3 users, 30 products, 60 orders)
pnpm --filter @mfe/api dev   # http://127.0.0.1:4000/health
```

Demo users (**demo-only credentials, never reuse**): `admin@lab.test`, `editor@lab.test`, `viewer@lab.test`, all with password `lab12345`. Passwords are hashed with scrypt (`node:crypto`), no extra dependency.

## Auth

- `POST /auth/login` with `{ "email", "password" }` returns `{ token, user }`. Wrong password and unknown email give the same `401 invalid_credentials`; a bad body gives `400 invalid_body`.
- `GET /auth/me` with `Authorization: Bearer <token>` returns the current user (read from the DB, so a deleted user gets `401`).
- Tokens are HS256 JWTs valid for **15 minutes**. There are no refresh tokens by design: log in again (RFC 0002).
- Routes are protected with `preHandler: app.authenticate` or `app.requireRole('admin', 'editor')` (`401 unauthorized`, `403 forbidden`).
- `JWT_SECRET` env sets the signing secret (see `.env.example`, **demo-only**). If unset outside production, the API uses an insecure dev secret and logs a warning; in production a missing secret is a startup error.

## Endpoints

All routes except `GET /health`, `POST /auth/login`, `POST /errors` and `/docs*` need `Authorization: Bearer <token>` (auth runs before validation, so no token is always `401`). Errors are always `{ "error": "<code>" }`: `invalid_body` / `invalid_query` / `invalid_params` (400), `unauthorized` (401), `forbidden` (403), `not_found` (404, also for unknown routes), `invalid_canary_url` (400, `PATCH /registry/:name`: not an allowlisted manifest URL, RFC 0017), `conflict` (409), `internal` (500).

| Route                                   | Roles allowed | Notes                                                                                                                                                                                                                |
| --------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /products`                         | any           | `?page&limit&sort&order&q`; returns `{ items, total, page, limit }`; `q` matches name or sku, case-insensitive                                                                                                       |
| `GET /products/:id`                     | any           |                                                                                                                                                                                                                      |
| `POST /products`, `PATCH /products/:id` | admin, editor | duplicate sku gives `409`                                                                                                                                                                                            |
| `DELETE /products/:id`                  | admin, editor | `409` if the product has orders                                                                                                                                                                                      |
| `GET /orders`                           | any           | `?page&limit&status`; newest first                                                                                                                                                                                   |
| `POST /orders`, `PATCH /orders/:id`     | admin         | create sets status `new`; PATCH sets `status`                                                                                                                                                                        |
| `GET /stats`                            | any           | counts, revenue by status, orders per day (UTC)                                                                                                                                                                      |
| `GET /flags`                            | any           | `{ name, enabled, description }[]` sorted by name                                                                                                                                                                    |
| `GET /registry`                         | public        | `{ name, canaryUrl, canaryPercent, disabled }[]` sorted by name, `Cache-Control: no-store`                                                                                                                           |
| `PATCH /registry/:name`                 | admin         | optional `canaryUrl` (https, or localhost with a port, ending `/mf-manifest.json`), `canaryPercent` 0-100, `disabled`; unknown name `404`                                                                            |
| `PATCH /flags/:name`                    | admin         | body `{ enabled }`; unknown name gives `404`                                                                                                                                                                         |
| `POST /errors`                          | none          | error report from a browser; limits `message` 2000, `stack` 8000, `url` 2000 (http(s) only), body 16 KB: over the limit is `400 invalid_body` (`413` for the body), nothing is truncated; keeps the newest 1000 rows |
| `GET /errors`                           | admin         | `?remote`; newest 50                                                                                                                                                                                                 |
| `GET /errors/summary`                   | admin         | `{ remote, count }[]`                                                                                                                                                                                                |
| `DELETE /errors`                        | admin         | returns `204`                                                                                                                                                                                                        |

Pagination defaults to `page=1&limit=20` (max `limit` 100); `sort` is one of `id, sku, name, price_cents, stock, created_at`.

Interactive OpenAPI docs: <http://localhost:4000/docs> (spec at `/docs/json`; both public).

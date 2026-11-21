# RFC 0013: Postgres for the API

- **Status:** Accepted
- **Author:** mfe-lab
- **Date:** 2026-11-21
- **Related:** [RFC 0001](0001-module-federation-for-frontend.md)

## Summary

The API moves from SQLite to Postgres. Production uses Neon over TCP (`pg`). Local dev and tests use PGlite, real Postgres compiled to WASM and running in-process, so nothing needs Docker. The SQL dialect is Postgres everywhere. `DATABASE_URL` selects the database.

## Motivation

Hosting the API on Vercel functions needs an external database, because function disks are ephemeral. The lab should also show a real client-server database, not a file.

## Goals / Non-goals

- Goal: one SQL dialect in dev, test and production.
- Goal: no Docker needed for `pnpm dev`, `pnpm test` or CI.
- Goal: unchanged HTTP contract and JSON shapes.
- Non-goal: the Vercel wrapper, CORS and deployment (T30, T31).
- Non-goal: an ORM or query builder.

## Proposal

`apps/api/src/db.ts` exposes a small async `Db` (`query`, `exec`, `tx`, `close`) with `$1..$n` placeholders, and `openDb(url)`: `postgres://` opens a `pg` Pool, `pglite:memory` an in-memory PGlite, `pglite:<dir>` a file-backed one. The rest of the code only sees `Db`. Migrations stay plain `NNN_name.sql` files, each applied in one transaction and recorded in `schema_migrations`. `int8`, `numeric` and `timestamptz` are parsed to numbers and ISO strings, so responses are identical to the SQLite ones. Unique and foreign-key violations (`23505`, `23503`) map to 409.

## Alternatives considered

| Option                  | Why not                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------ |
| SQLite on Render        | A free instance sleeps; the cold start is about a minute on a visitor's first click. |
| Turso / libSQL          | A vendor in transition, and staying on SQLite gives no Postgres story.               |
| Supabase                | Free projects pause after about a week of inactivity.                                |
| Docker Postgres in test | Slower, and every contributor needs Docker.                                          |

## Trade-offs and risks

- PGlite is single-connection, so tests and dev do not exercise pool concurrency. Accepted: the lab has no concurrent writers.
- Two drivers behind one interface. Accepted: the interface is four methods.
- The schema was rewritten in place (no production data existed), so an old SQLite file is not migrated.

## Rollout

T29 in `docs/PLAN.md`, one PR. Neon and Vercel wiring follow in T30 and T31.

## Hosting

The API runs on Vercel as one Function against Neon (T30, `docs/deploy.md`). The entry is `apps/api/src/vercel.ts`, bundled by rolldown because Vercel does not run `.ts` import specifiers; PGlite stays a dynamic import so production never loads it. The `pg` pool is small (`max: 3`) since Neon pools on its side, and production never migrates at startup.

## Open questions

- None.

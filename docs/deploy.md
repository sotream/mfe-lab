# Deploying to Vercel (prepared in T30, provisioned and deployed from Actions in T31)

Each app is its own Vercel project, built from the monorepo with its own root directory. Nothing here changes local dev, Docker or e2e.

The Swagger UI (`/docs`) is not served on Vercel: `@fastify/swagger-ui` pulls in an ESM-only dependency through `require()`, which the Vercel function loader rejects. The OpenAPI spec is still built; use `/docs` locally.

| Vercel project      | Root dir         | Production URL                         |
| ------------------- | ---------------- | -------------------------------------- |
| `mfe-lab` (shell)   | `apps/shell`     | `https://mfe-lab.vercel.app`           |
| `mfe-lab-products`  | `apps/products`  | `https://mfe-lab-products.vercel.app`  |
| `mfe-lab-dashboard` | `apps/dashboard` | `https://mfe-lab-dashboard.vercel.app` |
| `mfe-lab-api`       | `apps/api`       | `https://mfe-lab-api.vercel.app`       |

## One place for URLs

`deploy/urls.json` holds the four URLs. `node scripts/vercel-config.ts` generates the four `apps/*/vercel.json` from it (the generated files are committed; a test checks they are up to date). If a `*.vercel.app` name is taken, edit `urls.json` and rerun the script.

## Static apps (shell, products, dashboard)

`vercel.json` mirrors `docker/nginx.conf.template`:

- `/api/:path*` is rewritten to the API project (prefix stripped), so the browser stays same-origin and needs no CORS for the API; then everything else falls back to `/index.html`.
- products and dashboard send `Access-Control-Allow-Origin: *` (the shell loads their manifests and chunks).
- `/mf-manifest.json` and `/remoteEntry.js` are `no-store`.
- `Cache-Control: public, max-age=31536000, immutable` only on the content-hashed fonts (`<16 hex>.woff2`). JS and CSS chunks use stable names (`main.js`, `172.js`), so they are not immutable.
- Install and build run from the root-dir project with `pnpm install --frozen-lockfile --filter @mfe/<app>...` and `pnpm build`; output is `dist`. Vercel needs "Include source files outside of the Root Directory" enabled (the default).
- The shell gets `MF_PRODUCTS_URL` and `MF_DASHBOARD_URL` at build time (exported by `deploy.yml` from `urls.json`; `vercel build` ignores `build.env`), pointing at the production remotes' `/mf-manifest.json`; the job fails if the build output contains `localhost:300`.

## API (Vercel Function)

- `pnpm build` in `apps/api` bundles `src/vercel.ts` with rolldown to `apps/api/api/index.js` (gitignored). Vercel does not resolve our `.ts` import specifiers, hence this one build step; local dev and Docker still run `.ts` directly.
- The deploy job runs `pnpm --filter @mfe/api build` before `vercel build`: Vercel detects `api/*` functions before `buildCommand` runs, so a bundle produced only by it is never seen and the API 404s; a guard step fails the job if `.vercel/output/functions` has no `.func`.
- `apps/api/public/` holds only `robots.txt` (disallow all) because Vercel needs a non-empty static output directory: with `framework: null` and a build command, an empty or missing `outputDirectory` fails the build (`STATIC_BUILD_NO_OUT_DIR` / `STATIC_BUILD_EMPTY_OUT_DIR`). It also keeps the API out of search indexes; the `api/` function is detected separately.
- `vercel.json` sets `framework: null` (no zero-config Fastify detection, which would pick `src/app.ts`) and rewrites every path to the function.
- The function builds one Fastify app per warm instance, never calls `listen()`, and never migrates (`migrate: false`). Migrations run in CI (see Deploy flow); `provision.yml` also seeds once.
- PGlite is imported dynamically only for `pglite:` URLs, so production never loads it. The `pg` pool has `max: 3` and a 10 s idle timeout; use Neon's pooled connection string.
- Node 26 (`engines.node` `26.x` in `apps/api/package.json`).

### Env (set by `provision.yml`, never committed)

| Project | Variable       | Value                                                          |
| ------- | -------------- | -------------------------------------------------------------- |
| api     | `DATABASE_URL` | Neon pooled connection string (updated if it changes)          |
| api     | `JWT_SECRET`   | random, 32 bytes, created once and never rotated by the script |
| api     | `CRON_SECRET`  | random, 32 bytes, created once and never rotated by the script |
| static  | none           | shell URLs come from `deploy.yml` at build time                |

All three are type `sensitive` on the production and preview targets. The API function runs in `fra1`, next to the database (`aws-eu-central-1`).

### Daily demo reset

`crons` runs `GET /cron/reseed` at 03:00 UTC (Hobby allows daily). The route needs `Authorization: Bearer <CRON_SECRET>` (401 otherwise) and is a 404 when `CRON_SECRET` is unset, so dev and Docker never expose it. It runs `seed(db, { reset: true })` and returns `{ reseeded, users, products, orders }`. It is hidden from Swagger. Vercel runs crons on production deployments only.

## Not on Vercel

`releases/` (frozen remote versions, `pnpm release`) is not built on Vercel, same as in Docker, so the inspector offers only `dev`.

## Provision once

`.github/workflows/provision.yml` (manual, `workflow_dispatch`) runs `node scripts/provision.ts`, which uses the Vercel and Neon REST APIs with plain `fetch` and is idempotent:

- Neon: finds or creates the project `mfe-lab` (Postgres 17, `aws-eu-central-1`).
- Vercel: finds or creates the four projects (`framework: null`, root dir `apps/<name>`, Node 26.x), then checks that each production domain is the `*.vercel.app` URL in `deploy/urls.json` and fails naming the actual domain if not.
- API env vars as above. `DATABASE_URL` is a sensitive value that cannot be read back, so its comment holds a short hash of the URI; the script rewrites it only when the hash differs.
- The Neon URI is stored with `sslmode=verify-full` (not `require`, which pg warns about); the first run after this change rewrites `DATABASE_URL` once.
- The workflow then migrates and seeds Neon and checks that the database has 3 users. The pooled URI is fetched inside the job and masked with `::add-mask::`.

The script logs only names, ids and created / exists / updated. Re-run it any time; a second run changes nothing.

## Deploy flow

`.github/workflows/deploy.yml` runs when CI succeeds for a push to `main` (`workflow_run`), or by hand (`workflow_dispatch`, input `apps`: `changed` or `all`). Nothing is deployed from pull requests.

1. `plan` checks out the commit CI ran on (`workflow_run.head_sha`; the default checkout would be the newest `main`), and lists the files of `HEAD~1..HEAD` (a squash merge is one commit per PR). `scripts/changed-apps.ts` maps them to apps.
2. `api`: migrate Neon, then deploy.
3. `products` and `dashboard` in parallel.
4. `shell` last.
5. `smoke` checks the live URLs: shell `<title>`, `/api/health` 200, the products manifest (200, CORS `*`, `no-store`), and `/cron/reseed` 401 without auth.

Per app: `vercel link --yes --project <name>` (so no project id is stored), `vercel pull --yes --environment=production`, `vercel build --prod`, `vercel deploy --prebuilt --prod`. The CLI is pinned in `deploy.yml` (`VERCEL_CLI`) and runs with `pnpm dlx`. Jobs run under `concurrency: deploy` without cancelling.

### What gets deployed

| Changed path                                                                                                                                                                 | Apps     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `apps/<x>/**` (the API's migrations included)                                                                                                                                | `<x>`    |
| `packages/**`, `federation.shared.ts`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, root `package.json`, `deploy/**`, `scripts/vercel-config.ts`, `.github/workflows/deploy.yml` | all four |
| docs, tests, `e2e/`, the rest of `.github/**`                                                                                                                                | none     |

If two merges land while a deploy is running, the queue keeps only the newest pending run, so the skipped commit's changes are not deployed. Run `deploy.yml` with `all` to catch up.

No PR previews yet: an API preview would use the production database. Previews with a Neon branch per PR are a later task.

### Secrets (names only)

Repository secrets: `VERCEL_TOKEN`, `NEON_API_KEY`. The Vercel GitHub app is not needed. Set them yourself with `gh secret set`; never paste values to an agent. The runtime secrets live only in the Vercel project env.

## Owner checklist

1. Create Vercel and Neon accounts (a Vercel team and a Neon organization are fine: `scripts/provision.ts` discovers them from the tokens and `deploy.yml` passes `--scope`; nothing is stored, and several teams or orgs fail with a listing).
2. `gh secret set VERCEL_TOKEN` and `gh secret set NEON_API_KEY`.
3. After merge: run `provision.yml`, then `deploy.yml` with `all`.

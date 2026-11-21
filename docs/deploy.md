# Deploying to Vercel (prepared in T30, first deploy in T31)

Each app is its own Vercel project, built from the monorepo with its own root directory. Nothing here changes local dev, Docker or e2e.

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
- The shell gets `MF_PRODUCTS_URL` and `MF_DASHBOARD_URL` at build time (`build.env`), pointing at the production remotes' `/mf-manifest.json`.

## API (Vercel Function)

- `pnpm build` in `apps/api` bundles `src/vercel.ts` with rolldown to `apps/api/api/index.js` (gitignored). Vercel does not resolve our `.ts` import specifiers, hence this one build step; local dev and Docker still run `.ts` directly.
- `vercel.json` sets `framework: null` (no zero-config Fastify detection, which would pick `src/app.ts`) and rewrites every path to the function.
- The function builds one Fastify app per warm instance, never calls `listen()`, and never migrates (`migrate: false`). Run migrations against Neon yourself: `DATABASE_URL=<neon url> pnpm --filter @mfe/api migrate` (then `seed` once).
- PGlite is imported dynamically only for `pglite:` URLs, so production never loads it. The `pg` pool has `max: 3` and a 10 s idle timeout; use Neon's pooled connection string.
- Node 26 (`engines.node` `26.x` in `apps/api/package.json`).

### Env (set in the Vercel project, never committed)

| Project | Variable       | Value                                       |
| ------- | -------------- | ------------------------------------------- |
| api     | `DATABASE_URL` | Neon pooled connection string               |
| api     | `JWT_SECRET`   | long random string                          |
| api     | `CRON_SECRET`  | long random string (Vercel Cron sends it)   |
| static  | none           | shell URLs are in `vercel.json` `build.env` |

### Daily demo reset

`crons` runs `GET /cron/reseed` at 03:00 UTC (Hobby allows daily). The route needs `Authorization: Bearer <CRON_SECRET>` (401 otherwise) and is a 404 when `CRON_SECRET` is unset, so dev and Docker never expose it. It runs `seed(db, { reset: true })` and returns `{ reseeded, users, products, orders }`. It is hidden from Swagger. Vercel runs crons on production deployments only.

## Not on Vercel

`releases/` (frozen remote versions, `pnpm release`) is not built on Vercel, same as in Docker, so the inspector offers only `dev`.

## Owner checklist for T31

1. Create Vercel and Neon accounts.
2. Install the Vercel GitHub app on `sotream/mfe-lab`.
3. `claude mcp add` the Vercel and Neon MCP servers and finish OAuth.
4. Create a Vercel token in the dashboard and store it yourself: `gh secret set VERCEL_TOKEN`. Do not paste secret values to the planner or an agent.

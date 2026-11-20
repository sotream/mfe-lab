# Build, test, run

## Build

```bash
pnpm build   # apps/*/dist (remotes emit mf-manifest.json)
```

Remote manifest URLs are baked into the shell at build time; override with `MF_PRODUCTS_URL` / `MF_DASHBOARD_URL` (defaults `http://localhost:3001|3002/mf-manifest.json`). Package versions live in the `catalog:` of `pnpm-workspace.yaml`.

## Testing

- **Unit and component (black-box):** `pnpm test` runs Vitest. API tests use Fastify `inject` with in-memory SQLite; frontend tests use Testing Library. Tests are written from the task contract in `docs/PLAN.md`, not from the implementation.
- **E2E:** `pnpm e2e` runs one Playwright suite in `e2e/` against the dev servers in headless Chromium.
- **E2E on Docker images:** `pnpm e2e:docker` runs the same specs against the compose stack.

```bash
pnpm exec playwright install chromium   # once
pnpm e2e
pnpm e2e:docker
```

Playwright starts the API (after seeding), products, dashboard and shell itself. Locally it reuses servers that are already running (for example from `pnpm dev`) and does not stop them; in CI (`CI` set) it always starts its own. The suite covers login, both remotes rendering, the shared login (a viewer cannot see "Add product", an editor can), the inspector, and the remote-down fallback, which is simulated by aborting requests to `:3001`. Before the tests, `e2e/global-setup.ts` freezes two products releases, `0.0.1-e2e` and `0.0.2-e2e`, for the version-switching spec; `e2e/global-teardown.ts` deletes them and their `releases/index.json` entries. `pnpm e2e:docker` runs the compose stack (`docker compose up --build`, which Playwright stops afterwards; local only, `act` cannot run Docker). It skips the release fixtures and `E-versions`, because nginx serves no `releases/`. The containers are stopped, not removed; `docker compose down -v` removes them and the DB volume, and is the cleanup after an aborted run. Reports and traces go to `playwright-report/` and `test-results/` (gitignored).

## Docker

```bash
docker compose up --build -d   # shell :3000, products :3001, dashboard :3002
docker compose down -v         # stop and drop the DB volume
```

One `Dockerfile`, three targets: `build` (install and build all apps), `api` (production deps only, seeds on start, then `node src/server.ts`) and `web` (nginx with build arg `APP`). nginx falls back to `index.html`, proxies `/api/` to the API with the prefix stripped, sends `Access-Control-Allow-Origin: *` and `no-store` for `mf-manifest.json` and `remoteEntry.js`. The API listens on `HOST` (default `127.0.0.1`, compose sets `0.0.0.0`) and is not published to the host. The compose `JWT_SECRET` is demo-only. Manifest URLs stay `localhost:3001/3002`, so this is a local setup. CI does not cover it: `act` runs inside Docker.

## CI locally

CI runs on GitHub Actions for every push to `main` and every PR. To reproduce it locally, use [act](https://github.com/nektos/act) from a fresh clone of the committed branch (a worktree's `.git` points to a host path that does not exist in the container, and the clone tests only committed state, like real CI):

```bash
d=$(mktemp -d) && git clone -q -b <branch> "$PWD" "$d" && (cd "$d" && act pull_request -P ubuntu-latest=catthehacker/ubuntu:act-latest); rm -rf "$d"
```

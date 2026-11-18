# AGENTS.md: rules for builder agents

Project: `mfe-lab`, a private learning monorepo for Federated Micro Frontends. Read in order: `docs/BRIEF.md`, `docs/PLAN.md`, `docs/rfc/`.

## Workflow

- Take **one task** from `docs/PLAN.md`. Branch `t<N>-<slug>`. Do only that task.
- Work in your own git worktree. Never run HEAD-moving git in another agent's directory.
- Builder agents write code; a separate tester agent writes black-box tests from the plan contract; both land in the same PR.
- Tests ship in the same change as the code. Run `pnpm lint && pnpm typecheck && pnpm test` before finishing.
- One PR per task, squash merge, title in conventional commits (`feat(api): add products CRUD`). Few commits, no chains of tiny fixups.
- GitHub Actions minutes are unavailable: before any push or merge, run CI locally from a fresh clone of the committed branch: `d=$(mktemp -d) && git clone -q -b <branch> "$PWD" "$d" && (cd "$d" && act pull_request -P ubuntu-latest=catthehacker/ubuntu:act-latest); rm -rf "$d"` and paste the result into the PR. Not from a worktree: its `.git` points to a host path that does not exist in the container; the clone also tests only committed state, like real CI.
- **No AI attribution** in commits or PR text: no `Co-Authored-By`, no "Generated with" lines.
- `main` is protected: PR only. The owner merges unless told otherwise.
- If the task conflicts with an RFC, stop and write the question in the PR; do not silently diverge. Decision changes = edit the RFC in the same PR.

## Stack rules

- TypeScript strict everywhere. ESM. Node 26 (latest LTS). pnpm only.
- Frontend: React 19, Rspack, `@module-federation/enhanced`. No UI library, plain CSS (CSS variables), no Tailwind.
- Fonts, if any, self-hosted in the repo. No CDN, no external requests at runtime.
- API: Fastify, `better-sqlite3`, zod, `@fastify/jwt`. Prefer stdlib and what is installed; add a dependency only with a one-line reason in the PR.
- Shared singletons: `react`, `react-dom`, `react-router`, `@mfe/auth-store`. Everything shared is declared in one place per app (`federation.shared.ts`) from a common list.
- API runs TS natively on Node 26: `.ts` import extensions, erasable syntax only (no enums, namespaces, parameter properties), no build step.
- Keep it small. This is a lab: no speculative abstractions, no config for values that never change.

## Secrets and data

- Demo passwords only for seed users, documented as demo-only.
- `.env` never committed; `.env.example` is. SQLite files gitignored.

## Ports

shell 3000, products 3001, dashboard 3002, api 4000. Check free ports before starting servers; never kill processes you did not start.

## Definition of done per task

Acceptance line of the task in `docs/PLAN.md` met, CI green, README/RFC touched if behavior changed, PR description lists what was verified and how.

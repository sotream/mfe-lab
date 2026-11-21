# RFC 0015: Performance budgets

- **Status:** Accepted
- **Author:** mfe-lab
- **Date:** 2026-11-21
- **Related:** [RFC 0005](0005-prefetch-remotes.md), [RFC 0004](0004-versioned-remotes.md)

## Summary

Bundle size is gated in CI on every PR. Web Vitals are measured on the live site after every deploy. Budgets live in one file, `perf-budget.json`. JS and CSS get content-hashed names so unchanged files are cached for a year.

## Motivation

Nothing checked size or speed. RFC 0005 was measured once, by hand. JS and CSS had stable names (`main.js`, `149.js`), so browsers revalidated every file on every visit, and only fonts were `immutable`.

## Goals / Non-goals

- Goal: a size regression fails the PR; a speed regression fails the deploy job.
- Goal: hashed assets are `immutable`; entry points stay fresh.
- Non-goal: real-user monitoring, per-route budgets, history of results.

## Proposal

**Hashed names.** `[name].[contenthash:16].js` and `.css` for entries and chunks in all three apps. Fixed names stay for `remoteEntry.js`, `mf-manifest.json`, `mf-stats.json` and `index.html`, because the shell and users fetch them by a stable URL. The generated `vercel.json` files and the nginx template send `Cache-Control: public, max-age=31536000, immutable` only for names with a 16-hex hash (js, css, woff2); the no-store rule for manifest and `remoteEntry.js` is unchanged.

**Size, in CI.** `node scripts/size-budget.ts` runs after `pnpm build` and gzips (level 9) per app:

- `initialJsGzip`: shell, the scripts in `index.html`; remotes, `remoteEntry.js` plus the sync chunks of every expose in `mf-manifest.json`. Derived from build output, no hand-kept lists.
- `totalJsGzip`: every `.js` in `dist/`.
- `cssGzip`: every `.css` in `dist/`.

It prints app, metric, size, budget and percent used, and exits 1 naming each metric over budget. Size is deterministic, so it fails fast and never flakes. Budgets are the measured size plus 10%, rounded up to 1 KB. `--budget <file>` (or `SIZE_BUDGET`) points at another budget file.

**Vitals, after deploy.** `scripts/vitals.ts` drives Chromium (the installed `@playwright/test`) against the live shell with CDP Fast 4G (150 ms, 1.6 Mbps down, 750 kbps up, as RFC 0005) and 4x CPU. Five runs, each in a fresh context with an empty cache; the median decides.

- `/login` cold: LCP and CLS, watched until 3 s after load (native `PerformanceObserver`).
- Home after sign-in: time-to-remotes (submit until the first products row and the dashboard chart are visible) and the CLS of that step.

Budgets: LCP 2500 ms (the Google "good" threshold), CLS 0.1, time-to-remotes the measured median plus 25%, rounded up to 100 ms. Vitals budgets are calibrated on the CI runner, measured where the job runs, because that is where the job runs; the runner is in the US and the API in fra1, so it adds transatlantic API latency. Time-to-remotes was measured twice: laptop in Germany, median 495 ms; CI runner in the US, median 822 ms (p90 1351). The first CI run failed the 700 ms budget taken from the laptop number; the budget is 1100 ms (822 + 25% = 1028, rounded up). The `vitals` job in `deploy.yml` runs after `smoke`, writes a table to the job summary and fails when a median is over.

**Raising a budget.** Edit `perf-budget.json` in the same PR as the change that needs it, with the reason and the new measurement in the PR text. A budget is never raised to make a red check pass without a reason.

Budget log:

- 2026-11-21, shell `cssGzip`: 7168 to 9216 (measured 7466). Reason: custom select + skeleton components in the design system.

## Alternatives considered

| Option                 | Why not                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Vitals in PR CI        | PR e2e runs against dev servers, so numbers would be noise; the production build and a real CDN only exist live. |
| Size only after deploy | Too late and the PR is already merged; size is deterministic and cheap to gate earlier.                          |
| `web-vitals` library   | An extra dependency for three numbers the browser already exposes through `PerformanceObserver`.                 |
| Lighthouse CI          | Heavy dependency; needs its own server or storage for history, and its score is a blend we do not need.          |
| Real-user monitoring   | Needs a collector and traffic; a demo has neither.                                                               |

## Trade-offs and risks

- Lab data from one GitHub runner is not what users see. Medians of five runs and generous budgets keep it stable; a flaky red is a reason to widen a budget, with a note.
- A vitals failure comes after the deploy, so it warns, it does not block or roll back.
- The measured time-to-remotes is warm for the remotes: they are prefetched on idle while the page waits on `/login` (RFC 0005). That is the real user path, not a cold one.
- Demo logins are used against the public demo; it has no private data.

## Rollout

T34 in `docs/PLAN.md`: hashed names, `perf-budget.json`, the two scripts, the CI step and the `vitals` job in one PR.

## Open questions

- None.

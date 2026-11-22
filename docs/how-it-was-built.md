# How it was built

A short write-up of the process behind this repo: who did what, how each task moved from an idea to production, what kept the work honest, and what we would change next time.

## Setup

One person acted as product owner and reviewer: wrote the brief, approved plans, and merged. An AI planner split the work into tasks and wrote a contract for each one. AI builder and tester agents did the work, with split roles:

- the **builder** writes the code and nothing else;
- the **tester** writes black-box tests from the same written contract, without reading the implementation.

The split is the point. A test written by the author of the code tends to check what the code does. A test written from the contract checks what the code was supposed to do.

## The loop per task

Every task in [`docs/PLAN.md`](PLAN.md) went through the same steps:

1. The planner writes a contract: goal, "done when" line, files in scope, limits (no new dependency, no budget raised).
2. The builder implements it in its own git worktree, on a branch named after the task.
3. Tester phase 1: black-box tests from the contract only.
4. Tester phase 2: run against the real code; fix tests that assumed the wrong markup, report real bugs back to the builder.
5. The planner integrates both, runs the full suite, and checks the change in a browser.
6. One PR, CI, squash merge, deploy, then a check on the live site.

[PR #64](https://github.com/sotream/mfe-lab/pull/64) (T41, the compact Remotes table) is a typical example. Its description lists what changed, the bundle size delta against each budget, the test counts, and what was checked by hand in a browser.

## What kept it honest

- **Contracts before code.** Each task had an acceptance line before any code was written. A PR was done when that line was met, not when the code looked finished.
- **Independent tests.** The tester never saw the implementation while writing phase 1.
- **Signed commits.** Every commit is signed and uses a noreply address; a pre-push hook rejects any other email.
- **CI gates on every PR:** lint, typecheck, unit tests, a production build, gzipped size budgets, Playwright e2e, gitleaks over the full history, and conventional commit titles. After each production deploy, a vitals job measures LCP, CLS and time-to-remotes on the live site and fails the run if a budget is missed.
- **PR previews.** Each same-repo PR gets its own stack, with the API on its own database branch, and the stack is removed when the PR closes ([RFC 0018](rfc/0018-pr-previews-with-a-database-branch.md)).

These gates still missed things. Near the end, a separate model did an independent review of the whole repo. It found real problems:

- **Canary script injection.** Anyone signed in as the public demo admin could point a remote's canary at any URL, and the shell would load and run that script for every user in the bucket.
- **A writable public demo.** The demo admin could change the registry, flags and orders on the live site for every visitor.
- **An int4 overflow.** `/stats` multiplied quantity by price in 32-bit integers, so large values gave a 500.
- **Skipped deploys.** A cancelled CI run on `main`, or a Dependabot merge, could leave a commit that never reached production.

They were fixed in [#70](https://github.com/sotream/mfe-lab/pull/70) (canary allowlist, security headers), [#71](https://github.com/sotream/mfe-lab/pull/71) (demo lock, login rate limit), [#72](https://github.com/sotream/mfe-lab/pull/72) (overflow and other bugs) and [#69](https://github.com/sotream/mfe-lab/pull/69) (deploy pipeline). [#77](https://github.com/sotream/mfe-lab/pull/77) then brought the docs back in line with the code. All of these passed CI before the review. That is the case for an outside review: nobody in the loop had written a contract or a test for these attacks.

A second, final review at the end found no critical issues and one medium supply-chain risk: the deploy token was visible to dependency code during install and build. [#91](https://github.com/sotream/mfe-lab/pull/91) split each deploy into a build job without the token and a ship job that only deploys the prebuilt output. [#90](https://github.com/sotream/mfe-lab/pull/90) took the cheap performance wins from the same review.

Smaller things went wrong too. One example: after a header change, hashed assets on the live site lost their `immutable` cache header. Vercel parses `headers[].source` with an old `path-to-regexp`, where `{16}` outside a group is a literal, so the pattern matched nothing. The tests used `new RegExp` and passed. [#56](https://github.com/sotream/mfe-lab/pull/56) fixed the pattern and made the tests compile it the way Vercel does.

## Numbers

At the time of writing:

| What            | Count                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Tasks           | T0 to T63 merged                                                                                                        |
| Merged PRs      | 89 before this one, of which 8 from Dependabot                                                                          |
| Unit tests      | 913 in 134 files (`pnpm test`)                                                                                          |
| e2e tests       | 83 (Playwright, CI on `main`)                                                                                           |
| RFCs            | 18 ([index](rfc/README.md))                                                                                             |
| Size budgets    | initial JS gzip: shell 37 KB, products 71 KB, dashboard 56 KB, orders 72 KB ([`perf-budget.json`](../perf-budget.json)) |
| Vitals budgets  | LCP 2500 ms, CLS 0.02, time-to-remotes 1100 ms                                                                          |
| Last vitals run | LCP median 1756 ms, CLS 0.000, time-to-remotes median 690 ms                                                            |

## What we would do differently

- **Security review earlier.** The independent review came after T45. Run it after the first deploy, and again before the demo goes public.
- **Design the deploy pipeline for skips from the start.** Path-based diffs, cancelled runs and bot merges each created a way for a commit to miss production. Diffing from the last successful deploy should have been the first version.
- **Keep docs in the same PR as the code.** By T50, enough small changes had drifted that a whole task was needed to make the docs true again.

# RFC 0003: Native Federation comparison

- **Status:** Accepted (decision: no migration now)
- **Author:** owner
- **Date:** 2026-11-20
- **Related:** RFC 0001, RFC 0002, `docs/PLAN.md` (T11)

## Summary

Compare Module Federation 2 (`@module-federation/enhanced` on Rspack, what this repo uses) with Native Federation (`@softarc/native-federation`, import maps, usually esbuild). **Decision: stay on Module Federation 2.** Native Federation is a real option, but for this repo it would replace working Rspack, manifest, inspector and test code and gain little. The criteria that would change the answer are listed below. No prototype code was written.

## Motivation

RFC 0001 listed Native Federation as "a good candidate for a later comparison RFC". The lab is about federation, so the main alternative should be understood and written down, not guessed at.

## Goals / Non-goals

- Goal: compare the two on the axes that matter here, with sources, and record a decision.
- Goal: say what a migration would touch in this repo and roughly what it costs.
- Non-goal: build a Native Federation variant. A spike is described under Rollout.

## Facts checked (2026-11-20)

- Native Federation core, `@softarc/native-federation` [4.10.1](https://www.npmjs.com/package/@softarc/native-federation), last published 2026-11-14 (`npm view`). Its [README](https://github.com/native-federation/native-federation-core) says "This is v4", MIT, and describes it as the Module Federation mental model on browser standards: remotes are plain ES modules wired by an import map, with "polyfill support via es-module-shims". Shared deps use `singleton`, `strictVersion`, `requiredVersion: 'auto'` with semver-aware negotiation.
- Bundler side: the core needs an adapter. `@softarc/native-federation-esbuild` 4.4.0 exists (published 2026-11-15, `npm view`); its README lists React and vanilla as a use case. An [Angular Architects article](https://www.angulararchitects.io/en/?p=6532) (written for v1, so old) says React needs no deeper integration than the core. I found no React-specific adapter package and no official React starter (unverified: I did not search every repo).
- Runtime side: the browser runtime is [`@softarc/native-federation-orchestrator`](https://github.com/native-federation/orchestrator) 4.10.2 (2026-11-19), a vanilla-JS orchestrator that loads any remote built with `@softarc/native-federation` and reads a `remoteEntry.json` per remote. It does its own version resolution and has a Node entry for SSR. Its README names Angular and vanilla examples, no React. It calls its quickstart "intended for experimenting". There is also an older `@softarc/native-federation-runtime` (3.5.6).
- Maintenance: both are active (releases within the last week). The Angular adapter is the main driver of the project (Angular Architects); that is my reading of the package ecosystem, not a stated policy.
- Module Federation 2: [reported stable in April 2026](https://www.infoq.com/news/2026/04/module-federation-2-stable) (InfoQ; the article has an internal date inconsistency). Runtime is decoupled from the bundler. It lists type hints, Node/SSR consumption, `mf-manifest.json`, a Chrome devtools extension, and support for webpack, Rspack, Rollup, Rolldown, Rsbuild, Vite, Metro. `@module-federation/enhanced` is at 2.9.3 (published today). The [guide](https://module-federation.io/guide/start/index.html) still lists Router, Sandbox and SSR as planned higher-level capabilities.
- Interop: I found no official way to load a Native Federation remote from an MF2 host or the reverse. `@module-federation/vite` 1.24.1 exists; one third-party page says it is based on native-federation, which I could not confirm (unverified). Treat the two as separate ecosystems.

## Comparison

| Axis                 | Module Federation 2 (this repo)                                            | Native Federation                                                              |
| -------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Runtime model        | Own runtime (`registerRemotes`, `loadRemote`), container and share scope   | Browser ES modules and import maps; orchestrator builds the map                |
| Build-tool coupling  | Plugin per bundler (Rspack here); runtime is bundler-independent           | Bundler-agnostic core plus adapter (esbuild); no bundler-specific runtime      |
| Shared deps          | `shared` with `singleton`, `requiredVersion`; share scope at runtime       | `shared` in `federation.config.js`; each shared package built as an ES entry   |
| Manifest / discovery | `mf-manifest.json` per remote, URL registered at runtime                   | `remoteEntry.json` per remote; host reads a name-to-URL map                    |
| Dev experience       | HMR through Rspack dev server, devtools extension, build stamp in manifest | esbuild watch and rebuild; no equivalent of the MF devtools found (unverified) |
| Type sharing         | `@mf-types` generated and fetched for the consumer; we set `dts: false`    | Not covered by the docs I read; hand-written declarations                      |
| SSR                  | Node consumption supported in 2.0; the guide still lists SSR as planned    | Node entry in the orchestrator, import map via loader hook; Angular-proven     |
| Ecosystem maturity   | Larger: multiple bundlers, Next.js, Modern.js, many examples               | Smaller; Angular-centred; fewer React examples                                 |
| Standards alignment  | Proprietary runtime and manifest                                           | Import maps and ESM; polyfill needed for older browsers                        |

## Decision

Stay on Module Federation 2.

- The stack is Rspack by choice (RFC 0001); MF2 is the first-class path there, and the build, manifest, inspector and Playwright smoke already work.
- Native Federation's main selling points (no bundler lock-in, standards) are not problems this lab has. Its React story is thinner than the Angular one.
- A move would be a rewrite of the federation layer for no behavior gain, which AGENTS.md ("keep it small") argues against.

## When Native Federation would win

Revisit this RFC if any of these becomes true:

1. The bundler must be esbuild, or something with no MF2 plugin, and Rspack is dropped.
2. The product needs plain import-map loading: remotes consumed from non-JS hosts (server-rendered pages, other frameworks) through the orchestrator.
3. The team wants no runtime of its own in the page and accepts shipping `es-module-shims` for older browsers.
4. A team in the same organisation already ships Native Federation (for example Angular) and shared remotes matter more than the bundler.
5. MF2 development stalls, or its runtime shows a blocking bug that has no workaround.
6. A documented React starter and a React example of the orchestrator exist and pass a spike (see Rollout).

## What would change in this repo

| Today                                                                | With Native Federation                                                                                                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ModuleFederationPlugin` in three `rspack.config.ts`                 | `federation.config.js` per app plus an esbuild build script using the adapter                                                                                             |
| Root `federation.shared.ts` (one shared list, versions from catalog) | Shared list in each `federation.config.js`, or a helper imported by all three; `requiredVersion: 'auto'` reads package.json, which has `catalog:` specifiers (unverified) |
| `registerRemotes` and `loadRemote('products/ProductsPage')`          | Orchestrator `initFederation` and its load call (name unverified; the plan assumed `loadRemoteModule`)                                                                    |
| `mf-manifest.json`, `metaData.buildInfo.buildVersion`                | `remoteEntry.json`; the build stamp needs its own field or a side file                                                                                                    |
| Inspector reads manifests and the MF share scope                     | Inspector rewritten against the orchestrator's state                                                                                                                      |
| Rspack dev server: HMR, `/api` proxy, `experiments.css`              | esbuild serve or Vite for dev, own proxy, own CSS handling, own HMR (React Refresh)                                                                                       |
| `bootstrap.tsx` async boundary                                       | Not needed; shared modules resolve through the import map                                                                                                                 |
| `@module-federation/enhanced` in the catalog                         | `@softarc/native-federation`, `-esbuild`, `-orchestrator` in the catalog                                                                                                  |

## Migration cost (estimate, not measured)

- Build and dev setup for three apps, including CSS and HMR: 2 to 4 days.
- Runtime loading, shared singletons for `react`, `react-dom`, `react-router`, `@mfe/auth-store`, check that there is one copy of each: 1 to 2 days, mostly debugging.
- Inspector, build stamp, remote-down fallback, Retry behavior: 1 to 2 days.
- Playwright smoke, CI, docs, RFC 0001 and 0002 updates: 1 day.
- Total: roughly 5 to 9 days for one person. The risk is concentrated in singleton behavior and dev HMR, which are the parts least documented for React.

## Alternatives considered

| Option                                 | Why not                                                           |
| -------------------------------------- | ----------------------------------------------------------------- |
| Migrate now                            | Cost above, no behavior gain, thinner React story.                |
| Build a parallel Native Federation app | Doubles maintenance; a spike on a branch answers the question.    |
| `@module-federation/vite`              | Changes bundler, not model; does not address any current problem. |

## Trade-offs and risks

- Staying means depending on the MF runtime and manifest format, which are specific to one project. Mitigation: remote contracts stay small (one component per remote, RFC 0001), so switching later is bounded.
- The facts above come from a short review on 2026-11-20 and can age fast; versions are quoted from `npm view`.

## Rollout

None. No code change. If a criterion above is met, run a spike on a branch with one remote (`products`) and the shell, and check:

1. `react`, `react-dom`, `react-router` load once (one copy, same as the inspector shows today).
2. `@mfe/auth-store` stays a singleton, and login in the shell is seen by the remote.
3. Remote-down fallback and Retry work without a page reload.
4. Dev loop (edit, rebuild or HMR) is acceptable, and CSS works.
5. A production build runs without `es-module-shims` on the browsers we target.

## Open questions

- Does `requiredVersion: 'auto'` work with pnpm `catalog:` specifiers?
- Is there a maintained React example of the orchestrator?

## Changelog

- 2026-11-20: first version.

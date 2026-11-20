# RFC 0012: Locale across remotes

- **Status:** Accepted
- **Author:** mfe-lab
- **Date:** 2026-11-20
- **Related:** [RFC 0006](0006-data-between-remotes.md), [RFC 0008](0008-design-system-versioning.md), [RFC 0011](0011-accessibility-across-remotes.md)

## Summary

The lab is German by default for German browsers and has an EN switch. The shell owns the locale: it sets `<html lang>`, stores the choice and emits `locale:changed`. Each app translates its own strings from its own `messages.ts`. `@mfe/ui` 1.4.0 holds the one shared piece, the `Intl` formatters and the locale hooks.

## Motivation

Strings, dates and money are rendered by three independently deployed apps. If each decides the language alone, one page shows a German shell around an English table. A shared catalog or a shared store would tie their releases together again.

## Goals / Non-goals

- Goal: one source of truth for the locale, with an instant switch that needs no reload and no remount.
- Goal: German formats (`674,28 €`, `20.11.2026`, 24-hour time) and English formats (`€674.28`, `20/11/2026`).
- Goal: no new dependency and no new singleton.
- Non-goal: translating data (product names and flag descriptions come from the database).
- Non-goal: more than two languages, plural rules or right-to-left text.

## Proposal

**Owner.** The shell. Before the first render it sets `document.documentElement.lang` from `detectLocale()`. On a switch it sets `lang`, writes `localStorage['mfe-lab:locale']` and emits `locale:changed` `{ locale }` (an `@mfe/events` event, see the RFC 0006 changelog).

**Detection.** `detectLocale()` in `@mfe/ui`: a saved `de` or `en`, else the first `navigator.languages` entry that starts with `de`, else `en`. A throwing `localStorage` counts as "not saved".

**Reading.** `useLocale()` reads `document.documentElement.lang` (`de` if it starts with `de`, else `en`) and re-renders on `locale:changed`. A remote mounted after a switch reads the right value, and no prop crosses the frame, so nested routes and standalone mode work the same. A standalone remote's bootstrap sets `lang` itself and shows no switch.

**Messages.** Each app (shell, products, dashboard, and `@mfe/ui` for `RemoteFrame`) owns `src/messages.ts` with `{ de, en }`. `en` is typed as `typeof de`, so a missing key is a compile error. A string with a parameter is a function. `useT()` returns `messages[useLocale()]`. Announcements are built in the emitter's current locale. API codes (`new | paid | shipped`) are mapped to labels in the UI.

**Formats.** `formatMoney`, `formatNumber`, `formatDate` and `formatTime` in `@mfe/ui`, on `Intl` with `de-DE` and `en-GB`, currency EUR. Prices are gross cents, so there is no database change. Dates are formatted from the ISO value in UTC, so the day never shifts. The price input accepts a comma or a dot, at most two decimals, no thousands separators.

**Versions.** `@mfe/ui` 1.4.0 (additive). `requiredVersion` stays `^1.0.0`. With no `lang` set an app stays English, so an older shell with a new remote still works.

## Alternatives considered

| Option                             | Why not                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| An i18n library                    | A dependency for about 200 strings, plus its own runtime shared across remotes.  |
| The locale in `@mfe/auth-store`    | Mixes two concerns, and the store is a shared singleton for identity only.       |
| The locale as a `RemoteFrame` prop | Does not reach standalone remotes or nested routes.                              |
| One shared message catalog         | Couples every remote's release to the others; a new string needs a shell deploy. |

## Trade-offs and risks

- Three copies of a small `useT` hook. Accepted: it is three lines and keeps the apps independent.
- A remote that ignores `locale:changed` stays in the old language until it remounts. The type of `messages` and the tests make that unlikely.
- Legal text (Impressum) is German law text and stays German in the EN view, marked `lang="de"`.

## Rollout

T27 in `docs/PLAN.md`, one PR with the code, the docs and the tests.

## Open questions

- None.

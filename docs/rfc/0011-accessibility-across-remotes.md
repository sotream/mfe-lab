# RFC 0011: Accessibility across remotes

- **Status:** Accepted
- **Author:** mfe-lab
- **Date:** 2026-11-20
- **Related:** [RFC 0006](0006-data-between-remotes.md), [RFC 0007](0007-routing-inside-remotes.md), [RFC 0008](0008-design-system-versioning.md)

## Summary

Each accessibility concern has exactly one owner. The shell owns what belongs to the whole page: the title of a top-level route, focus after navigation, the skip link, the `h1` and the live region. A remote owns what is inside its frame: the title below its route, headings from `h3`, and announcements, which it sends to the shell as an `a11y:announce` event. `@mfe/ui` owns focus styles, contrast tokens and component semantics.

## Motivation

A page built from independently deployed apps has no single author, so page-level semantics go missing or double up. Two remotes with their own live regions announce twice or fight; two owners of `document.title` overwrite each other; a remote that guesses its heading level breaks the outline when the host layout changes. WCAG 2.2 AA (2.4.1, 2.4.2, 2.4.3, 1.3.1, 4.1.3) needs these decided once.

## Goals / Non-goals

- Goal: WCAG 2.2 AA structure across the shell and both remotes, with one owner per concern.
- Goal: static (`eslint-plugin-jsx-a11y`) and automated (`@axe-core/playwright`) checks in the normal workflow.
- Non-goal: a full manual audit report, or support for assistive technology beyond a manual pass with VoiceOver.
- Non-goal: announcements when a remote runs standalone. Nothing listens there; this is accepted.

## Proposal

**Ownership.**

| Concern                           | Owner     | How                                                                                                                                 |
| --------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Title of a top-level route        | shell     | `Home`, `Products`, `Dashboard`, `Inspector`, `Sign in`, each followed by ` – mfe-lab` (en dash), set on every navigation           |
| Title below a route               | remote    | `ProductDetail` sets `<name> – Products – mfe-lab` or `Product not found – Products – mfe-lab`                                      |
| Focus after navigation            | shell     | After any client-side navigation (back and forward included), not on the first render, focus moves to the page `h1` (`tabIndex=-1`) |
| Skip link and `main`              | shell     | `a.skip-link` is the first focusable element; `main#main` has `tabIndex=-1`                                                         |
| `h1`                              | shell     | One per page: `Products` and `Dashboard` are new and visible; Home, Inspector and Login keep theirs                                 |
| Frame name                        | `@mfe/ui` | `RemoteFrame` renders the remote name as an `h2` in its bar                                                                         |
| Headings inside a remote          | remote    | Start at `h3`; modal dialog titles stay `h2` (a modal is its own context)                                                           |
| Live region                       | shell     | One `role="status"` region, visually hidden, outside `main`, always in the DOM                                                      |
| Announcements                     | remote    | `emit('a11y:announce', { message })`; products on create, save and delete, the inspector on flag toggles and Clear errors           |
| Focus styles, contrast, semantics | `@mfe/ui` | `:focus-visible` ring, `--ds1-*` tokens, `Table` `label` makes a scrollable table a focusable region                                |

**Language.** Titles, announcements and the chart label are translated ([RFC 0012](0012-locale-across-remotes.md)); the English strings here are the `en` catalog and `<html lang>` follows the locale.

**Title order.** The shell sets its title in a layout effect, which runs before the passive effect of a remote, so on the detail route the remote's title wins and on every other navigation the shell's does.

**Live region.** The shell listens to `a11y:announce` and writes the message into the region. To re-announce an identical message it clears the region and sets the text again on the next tick.

**Chart.** The SVG keeps `role="img"` with a summary label (`Orders per day, <first> to <last>: <total> orders, peak <max> on <date>`). Bars are not focusable and have no label; the `Show data table` table is the accessible alternative.

**Remote failure.** The fallback is `role="alert"`. When Retry fails again the fallback is remounted and focus goes back to the Retry button.

**Automation.** `eslint-plugin-jsx-a11y` (recommended) runs on `apps/**` and `packages/**`. `@axe-core/playwright` runs the `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa` rule sets in the e2e suite and fails on `serious` and `critical` violations.

**Versions.** `@mfe/ui` 1.3.0 (additive): `Table` `label`, and the `h2` in the frame bar. `requiredVersion` stays `^1.0.0`. `@mfe/events` gets one event.

## Alternatives considered

| Option                                             | Why not                                                                       |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| Each remote keeps its own live region              | Duplicate or competing announcements; no one controls politeness or order.    |
| Remotes call `document.title` for top-level routes | Two owners; the last writer wins and the title depends on load order.         |
| Heading level passed to the remote as a prop       | Couples the remote to the host layout; a fixed `h3` start is simpler to hold. |

## Trade-offs and risks

- A remote loaded standalone announces nothing. The same actions still change the page visibly.
- Moving focus on every navigation is a rule of the shell; a remote that needs focus elsewhere inside its own subtree must do it after the shell's move.
- Automated checks find roughly a third of the issues. The manual pass (keyboard, VoiceOver, 200% zoom, 320 px) is recorded in the PR.

## Rollout

T26 in `docs/PLAN.md`: one PR with the contract, the lint rule and the docs; the `E-a11y` spec lands with the tests.

## Open questions

- None.

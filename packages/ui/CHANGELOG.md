# Changelog

Breaking changes need a major bump, a new CSS prefix (`ds2-`) and an entry here (RFC 0008).

## 1.10.0

- `Tooltip` (`content`, `tabStop?`, plus span attributes): `role="tooltip"` in the top layer, placed by `placePopup`. Hover after 300 ms, focus at once; hides on leave, blur and Escape (focus stays); hoverable (WCAG 1.4.13). `MiddleTruncate` (`text`, `tail?`): one line with the ellipsis in the middle and the tail (default from the last `/`, else 12 characters, or the last N) always visible; pure CSS, the full text in a visually hidden span and in a tooltip, always a tab stop. Styles in `@mfe/ui/tooltip.css` (consumer imports it). Additive.

## 1.9.0

- `Select`: a styled, accessible select-only combobox (APG) whose popup sits in the top layer (Popover API), so scroll regions and `overflow: clip` panels cannot clip it. Props: `options`, `value`, `onChange`, `labelId` or `aria-label`, `id`, `name`, `disabled`. Framework-free logic in `@mfe/ui/select-core` (`keyAction`, `typeahead`, `placePopup`, `attachPopup`, `bindLabel`) and the styles in `@mfe/ui/select.css` (the consumer imports it, so apps that do not use `Select` do not pay for it), reused by the Vue `DsSelect` in orders. Additive.

## 1.8.0

- New `Skeleton` (`width`, `height`, `radius`): a decorative `.ds1-skeleton` block with a slow shimmer (none under `prefers-reduced-motion`). `Table` takes `loading={{ rows, cols?, rowHeight? }}`: it renders `children` (the `<thead>`), then `rows` skeleton rows (`aria-hidden`) and sets `aria-busy`. `RemoteFrame` takes `fallback` (default a block skeleton) and its loading text is now visually hidden (still `role="status"`). Additive.

## 1.7.0

- `RemoteFrame` takes an optional `originTitle` (tooltip on the origin label). An ISO UTC build version shows compact as `build DD.MM HH:MMZ` in a `<time>` carrying the full value; other versions render unchanged. Additive.

## 1.6.1

- `RemoteFrame` header wraps instead of truncating: the build stamp moves to its own line when the label and origin leave no room, and a long origin wraps. No API change.

## 1.6.0

- `RemoteFrame` takes an optional `origin` shown as the header label as is; `port` is now optional (label `:port` when only it is given, no label with neither). Additive.

## 1.5.0

- `Table` with a `label` also renders a visually hidden `<caption>` with it, so the table has an accessible name. Table `th` body cells may be row headers (`th scope="row"`), styled like `td`. `.visually-hidden` now lives in `@mfe/ui/base.css`. Additive.

## 1.4.0

- Locale helpers (RFC 0012): `detectLocale`, `useLocale`, `formatMoney`, `formatNumber`, `formatDate`, `formatTime`, `LOCALE_KEY` and the `Locale` type. `RemoteFrame` strings (loading, unavailable, Retry, build, region label) follow the locale, `de` or `en`. Additive; an app with no `lang` set stays English.

## 1.3.0

- `Table` takes an optional `label`: the scroll wrapper becomes a focusable `region` named by it (keyboard scrolling, WCAG 2.1.1). Without `label` nothing changes.
- `RemoteFrame` renders the remote name as an `h2` in its bar (was a `span`), same look. Additive for consumers; a host's page `h1` then a frame `h2` is the heading contract in RFC 0011.

## 1.2.0

- Console theme: dark graphite palette, Host Grotesk and Atkinson Hyperlegible Mono (OFL, self-hosted woff2 in `src/fonts/`). New tokens `--ds1-paper`, `--ds1-ink`, `--ds1-accent`, `--ds1-cool`, `--ds1-bad` and others, plus the space, text, duration and ease scale; the 1.0.0 `--ds1-color-*` names stay and map onto them.
- `Button`, `Table`, `Field` restyled, same props and markup. Additive classes: `ds1-button--sm`, `ds1-input`, `ds1-mono`, `ds1-num`, `ds1-readings`.
- `RemoteFrame` shows a frame bar: the name, `:port` and `build <stamp>` as separate cells (the label `name · :port` is gone); the page sits in a `.remote-frame-body` wrapper and the fallback Retry is a `Button`. Per-remote frame colours are removed.
- `@mfe/ui/base.css`: page base (reset, body, headings, focus ring, reduced motion), imported once by the shell and by a remote's standalone entry.

## 1.1.0

- `RemoteFrame` takes an optional `report` prop, called with `{ remote, build, kind: 'render' | 'load', message, stack }` when the frame shows its fallback (RFC 0010). Additive.

## 1.0.0

- First versioned release: `Button` (primary, secondary, danger), `Table` and `Field` (label, input, error).
- Tokens `--ds1-*` on `:root`; classes `ds1-*`.

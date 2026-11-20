# Changelog

Breaking changes need a major bump, a new CSS prefix (`ds2-`) and an entry here (RFC 0008).

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

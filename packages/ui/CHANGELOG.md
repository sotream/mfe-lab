# Changelog

Breaking changes need a major bump, a new CSS prefix (`ds2-`) and an entry here (RFC 0008).

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

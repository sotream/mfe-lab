# Changelog

Breaking changes need a major bump, a new CSS prefix (`ds2-`) and an entry here (RFC 0008).

## 1.1.0

- `RemoteFrame` takes an optional `report` prop, called with `{ remote, build, kind: 'render' | 'load', message, stack }` when the frame shows its fallback (RFC 0010). Additive.

## 1.0.0

- First versioned release: `Button` (primary, secondary, danger), `Table` and `Field` (label, input, error).
- Tokens `--ds1-*` on `:root`; classes `ds1-*`.

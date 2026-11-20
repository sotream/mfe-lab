# How it works

The shell (`:3000`) is a Module Federation host. At runtime it loads two independently built and served remotes, `products` (`:3001`) and `dashboard` (`:3002`), by fetching their `mf-manifest.json`, then `remoteEntry.js`. `react`, `react-dom`, `react-router` and `@mfe/auth-store` are singletons: loaded once from the shell, and the remotes reuse that copy. Every remote slot is wrapped in `RemoteFrame` (error boundary, Suspense, labelled frame, Retry), so a dead remote shows a fallback and the rest of the page keeps working. The remotes call the API on `:4000` through the shell's `/api` proxy. After the first render the shell prefetches both remotes (manifest, entry, expose chunks) on browser idle, so the first visit to a remote page loads from cache (RFC 0005).

```mermaid
flowchart TB
  B([Browser]) --> S

  subgraph S["shell :3000 · host"]
    direction LR
    FP["RemoteFrame<br/>products slot"]
    SH[("shared singletons<br/>react · react-dom<br/>react-router · @mfe/auth-store<br/>loaded once")]
    FD["RemoteFrame<br/>dashboard slot"]
  end

  FP -- "loadRemote()<br/>mf-manifest.json → remoteEntry.js" --> P["products :3001<br/>exposes ./ProductsPage"]
  FD -- "loadRemote()<br/>mf-manifest.json → remoteEntry.js" --> D["dashboard :3002<br/>exposes ./DashboardPage"]
  P -. "reuses" .-> SH
  D -. "reuses" .-> SH
  P & D -. "REST + JWT" .-> A[("api :4000 · SQLite")]
```

Loading one remote, including the "remote down" path:

```mermaid
sequenceDiagram
  actor U as User
  participant S as shell :3000
  participant F as RemoteFrame
  participant P as products :3001

  U->>S: open /
  S->>F: render RemoteFrame (products)
  F-->>U: Loading products…
  F->>P: loadRemote('products/ProductsPage'): GET mf-manifest.json
  alt remote up
    P-->>F: manifest
    F->>P: GET remoteEntry.js and the expose chunk
    Note over F,P: react, react-dom, react-router, auth-store resolve to the shell's copies
    F-->>U: ProductsPage renders
  else remote down
    P--xF: fetch fails
    F-->>U: products is unavailable + Retry
    U->>F: click Retry
    F->>P: load() again (re-register, refetch manifest)
  end
```

## Edit a product, the dashboard updates

```mermaid
sequenceDiagram
  actor U as Editor
  participant PP as products (useMutation)
  participant API as api :4000
  participant W as window
  participant DD as dashboard (on)
  participant QC as dashboard QueryClient

  U->>PP: Save in the edit dialog
  PP->>API: PATCH /api/products/:id
  API-->>PP: 200 updated product
  PP->>PP: invalidateQueries(['products'])
  PP->>W: emit('products:changed', { id, kind })
  Note over PP,W: dispatchEvent(CustomEvent 'mfe:products:changed')
  W-->>DD: listener registered with on()
  DD->>QC: invalidateQueries(['stats'])
  QC->>API: GET /api/stats
  API-->>QC: counts, revenue, orders per day
  QC-->>U: stat tiles re-render
```

A failed mutation (409, 500) emits nothing.

## Who owns which state

```mermaid
flowchart LR
  subgraph shell["shell (host)"]
    AS[("@mfe/auth-store<br/>user + token<br/>shared singleton")]
    LOG["event log<br/>last 20, in memory"]
  end
  subgraph products["products remote"]
    PQ["QueryClient<br/>server state: products"]
    PR["Redux store productsUi<br/>page, sort, search, dialogs"]
  end
  subgraph dashboard["dashboard remote"]
    DQ["QueryClient<br/>server state: stats"]
  end
  EV{"@mfe/events<br/>window CustomEvent<br/>the only contract"}

  AS -. "read by" .-> products
  AS -. "read by" .-> dashboard
  products -- "emit products:changed" --> EV
  EV -- "on" --> dashboard
  EV -- "onAny" --> LOG
  PQ --- PR
```

Rules: no remote reads another remote's store or cache; `@tanstack/react-query`, `@reduxjs/toolkit`, `react-redux` and `@mfe/events` are not in `federation.shared.ts`; only `react`, `react-dom`, `react-router` and `@mfe/auth-store` are shared.

## Login flow

The shell owns login. `@mfe/auth-store` is a federation singleton (see [RFC 0002](rfc/0002-sharing-auth-state.md)), so the shell and both remotes read the same user and token. Guarded routes (`/`, `/products`, `/dashboard`) redirect anonymous users to `/login?next=<path>`; after signing in you land back on the page you asked for. The nav shows the email, a role chip and a Log out button.

The token lives in memory only, so **a page reload logs you out** (accepted trade-off, RFC 0002). API calls go through `@mfe/api-client` to the relative `/api/...`; each dev server proxies `/api` to `http://localhost:4000` (prefix stripped), so there is no CORS setup.

## Products remote

`apps/products` exposes `./ProductsPage` (no props): a table with search (300 ms debounce), sortable columns, pagination (10 per page), an add/edit dialog and a delete confirmation, all through `@mfe/api-client`. Admin and editor see the write actions; viewers only read. Validation lives in `apps/products/src/productForm.ts` (price is entered in dollars, stored as cents).

It also runs on its own: `pnpm --filter @mfe/products dev` serves it on `:3001` with a "Standalone dev" bar that signs in as the admin, editor or viewer demo account (the bar is not part of the exposed module, so the shell never shows it).

## Dashboard remote

`apps/dashboard` exposes `./DashboardPage` (no props): stat tiles (products, orders, revenue, paid revenue), an orders-per-day column chart in plain SVG, and revenue by status as bars. All data comes from `GET /stats` through `@mfe/api-client`. Days with no orders are filled with 0 so the time axis is honest. Each column has a hover and keyboard-focus tooltip, and a "Show data table" view lists the same numbers. Chart geometry and tick rules are in `apps/dashboard/src/stats.ts`.

It also runs on its own: `pnpm --filter @mfe/dashboard dev` serves it on `:3002` with the same "Standalone dev" bar as products (the bar is not part of the exposed module).

## Inspector and build stamps

Every build gets a stamp: `MF_BUILD_VERSION` if set, else the UTC time (`YYYY-MM-DDTHH:MM:SSZ`). It is baked in as `__BUILD_VERSION__`, written to `mf-manifest.json` (`metaData.buildInfo.buildVersion`), exported as `buildVersion` by both exposed pages, and shown in each remote frame and in the shell footer. Rebuild one remote and its stamp changes while the shell's stays. `/inspector` (no login) lists the remotes with their live manifest version and up/down status (polled every 5 s) and the shared dependencies read from the runtime's share scope.

## Data between remotes

Server state: products and dashboard each fetch through their own TanStack Query client, created per page mount and per user, bundled in each remote and never shared. After a user change the page refetches, so one user's rows are not shown to the next.

UI state: the products page keeps page, sort, order, search and open dialogs in a Redux Toolkit slice `productsUi`, in a store created per mount (`makeStore()`), local to products.

Between remotes: `@mfe/events` wraps `window` `CustomEvent`, so each remote may bundle its own copy and they still talk. The contract is the `EventMap` type in `packages/events/src/index.ts`; it has `products:changed` with `{ id, kind: 'created' | 'updated' | 'deleted' }` and `flags:changed` with `{ name, enabled }`. `emit` with an unknown name is a TypeScript error. Products emits it after a successful create, update or delete; the dashboard calls `invalidateQueries({ queryKey: ['stats'] })`. The shell subscribes with `onAny` and keeps the last 20 events for the inspector. Details and rejected alternatives: [RFC 0006](rfc/0006-data-between-remotes.md).

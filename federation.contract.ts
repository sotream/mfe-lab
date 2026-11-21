// The one federation contract (RFC 0014, RFC 0016): what each remote exposes, and of which kind.
// Providers generate their rspack `exposes` from it and type-check their modules against it; the
// shell derives its remote names and types from it. Edit here, and both sides fail typecheck
// until they agree.
export const exposes = {
  products: ['ProductsPage', 'ProductsApp'],
  dashboard: ['DashboardPage'],
  orders: ['OrdersApp'],
} as const;

/**
 * `react`: the module's default export is a React component. `mount`: the module exports
 * `mount(el, ctx)` and owns its own framework and DOM (RFC 0016).
 */
export const kinds = { products: 'react', dashboard: 'react', orders: 'mount' } as const;

export type RemoteName = keyof typeof exposes;
export type ExposedName<R extends RemoteName> = (typeof exposes)[R][number];
export type ModuleKind = (typeof kinds)[RemoteName];
export type KindOf<R extends RemoteName> = (typeof kinds)[R];
/** The remotes of one kind: `RemoteOfKind<'mount'>` is `'orders'`. */
export type RemoteOfKind<K extends ModuleKind> = {
  [R in RemoteName]: KindOf<R> extends K ? R : never;
}[RemoteName];

/**
 * What every `react` module must export. The root has no react types, so the default export is
 * any function component here; the shell narrows `C` to react's `ComponentType`.
 */
export type ExposedModule<C = (props: never) => unknown> = { default: C; buildVersion: string };

/** Plain data and callbacks, no framework types: what the shell hands a `mount` remote. */
export type MountContext = {
  locale: 'de' | 'en';
  /** Report an error the remote handled itself (the shell sends it to telemetry with the remote name). */
  onError(error: unknown): void;
};

/** What every `mount` module must export. `mount` returns the unmount function. */
export type MountModule = {
  mount(el: HTMLElement, ctx: MountContext): () => void;
  buildVersion: string;
};

/** rspack `exposes` for one remote: `./<Name>` -> `./src/<Name>.tsx` (react) or `.ts` (mount). */
export const exposesMap = (remote: RemoteName): Record<string, string> =>
  Object.fromEntries(
    exposes[remote].map((n) => [
      `./${n}`,
      `./src/${n}.${kinds[remote] === 'mount' ? 'ts' : 'tsx'}`,
    ]),
  );

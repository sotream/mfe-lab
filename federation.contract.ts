// The one federation contract (RFC 0014): what each remote exposes. Providers generate their
// rspack `exposes` from it and type-check their modules against it; the shell derives its
// remote names and types from it. Edit here, and both sides fail typecheck until they agree.
export const exposes = {
  products: ['ProductsPage', 'ProductsApp'],
  dashboard: ['DashboardPage'],
} as const;

export type RemoteName = keyof typeof exposes;
export type ExposedName<R extends RemoteName> = (typeof exposes)[R][number];

/**
 * What every exposed module must export. The root has no react types, so the default export is
 * any function component here; the shell narrows `C` to react's `ComponentType`.
 */
export type ExposedModule<C = (props: never) => unknown> = { default: C; buildVersion: string };

/** rspack `exposes` for one remote: `./<Name>` -> `./src/<Name>.tsx`. */
export const exposesMap = (remote: RemoteName): Record<string, string> =>
  Object.fromEntries(exposes[remote].map((n) => [`./${n}`, `./src/${n}.tsx`]));

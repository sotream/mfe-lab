import { loadRemote, registerRemotes } from '@module-federation/enhanced/runtime';
import type { RemoteModule } from '@mfe/ui';

// Manifest URLs are baked in at build time: MF_*_URL env overrides the localhost defaults.
declare const __MF_PRODUCTS_URL__: string;
declare const __MF_DASHBOARD_URL__: string;

const entries = {
  products: { entry: __MF_PRODUCTS_URL__, module: 'ProductsPage', port: 3001 },
  dashboard: { entry: __MF_DASHBOARD_URL__, module: 'DashboardPage', port: 3002 },
} as const;

export type RemoteName = keyof typeof entries;
export const remotePort = (name: RemoteName): number => entries[name].port;

registerRemotes(Object.entries(entries).map(([name, { entry }]) => ({ name, entry })));

const failed = new Set<RemoteName>();

export async function loadPage(name: RemoteName): Promise<RemoteModule> {
  // The runtime caches a failed manifest/entry fetch, so after a failure re-register the
  // remote with force: that drops the cached state and the next loadRemote refetches.
  if (failed.has(name)) {
    registerRemotes([{ name, entry: entries[name].entry }], { force: true });
  }
  try {
    const mod = await loadRemote<RemoteModule>(`${name}/${entries[name].module}`);
    if (!mod) throw new Error(`${name} returned no module`);
    failed.delete(name);
    return mod;
  } catch (err) {
    failed.add(name);
    throw err;
  }
}

import { loadRemote, preloadRemote, registerRemotes } from '@module-federation/enhanced/runtime';
import type { ComponentType } from 'react';
import {
  exposes,
  type ExposedModule,
  type ExposedName,
  type RemoteName,
} from '../../../federation.contract.ts';

// Manifest URLs are baked in at build time: MF_*_URL env overrides the localhost defaults.
declare const __MF_PRODUCTS_URL__: string;
declare const __MF_DASHBOARD_URL__: string;

type PageModule = ExposedModule<ComponentType>;

const urls: Record<RemoteName, string> = {
  products: __MF_PRODUCTS_URL__,
  dashboard: __MF_DASHBOARD_URL__,
};
// Remote names and the default (first) module per remote come from the federation contract.
const entries = Object.fromEntries(
  (Object.keys(exposes) as RemoteName[]).map((name) => [
    name,
    { entry: urls[name], module: exposes[name][0] },
  ]),
) as { [R in RemoteName]: { entry: string; module: ExposedName<R> } };

export const remoteManifests = Object.entries(entries).map(([name, { entry }]) => ({
  name,
  manifest: entry,
}));

export type { ExposedName, RemoteName };
// Where a remote lives, for the frame label: ":port" on localhost, else the hostname.
export function remoteOrigin(manifestUrl: string): string {
  const { hostname, port } = new URL(manifestUrl);
  return hostname === 'localhost' || hostname === '127.0.0.1' ? `:${port}` : hostname;
}

registerRemotes(Object.entries(entries).map(([name, { entry }]) => ({ name, entry })));

// The selected manifest per remote; absent = the build-time default. In memory only, like the token.
const selected = new Map<RemoteName, string>();
const listeners = new Set<() => void>();

export const remoteEntry = (name: RemoteName): string => selected.get(name) ?? entries[name].entry;

// null = back to the default. Re-registers with force so the next loadPage fetches the new manifest.
export function setRemoteEntry(name: RemoteName, manifestUrl: string | null): void {
  if (manifestUrl === null) selected.delete(name);
  else selected.set(name, manifestUrl);
  registerRemotes([{ name, entry: remoteEntry(name) }], { force: true });
  failed.delete(name);
  listeners.forEach((l) => l());
}

export function subscribeRemotes(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const releasesUrl = (name: RemoteName): string =>
  new URL('/releases/index.json', entries[name].entry).href;

export const releaseManifestUrl = (name: RemoteName, version: string): string =>
  new URL(`/releases/${version}/mf-manifest.json`, entries[name].entry).href;

const failed = new Set<RemoteName>();

export async function loadPage<R extends RemoteName>(
  name: R,
  module: ExposedName<R> = entries[name].module,
): Promise<PageModule> {
  // The runtime caches a failed manifest/entry fetch, so after a failure re-register the
  // remote with force: that drops the cached state and the next loadRemote refetches.
  if (failed.has(name)) {
    registerRemotes([{ name, entry: remoteEntry(name) }], { force: true });
  }
  try {
    const mod = await loadRemote<PageModule>(`${name}/${module}`);
    if (!mod) throw new Error(`${name} returned no module`);
    failed.delete(name);
    return mod;
  } catch (err) {
    failed.add(name);
    throw err;
  }
}

let prefetched = false;

// Warm the browser cache with both remotes (manifest, entry, expose chunks incl. async) once per page load.
export function prefetchRemotes(): void {
  if (prefetched) return;
  prefetched = true;
  try {
    preloadRemote(
      (Object.keys(entries) as RemoteName[]).map((name) => ({
        nameOrAlias: name,
        exposes: [`./${entries[name].module}`],
        resourceCategory: 'all' as const,
      })),
    ).catch((err) => console.warn('prefetchRemotes failed', err));
  } catch (err) {
    console.warn('prefetchRemotes failed', err);
  }
}

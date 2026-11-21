import { getRegistry, type RegistryRow } from '@mfe/api-client';
import { getState } from '@mfe/auth-store';
import {
  loadRemote,
  preloadRemote,
  registerPlugins,
  registerRemotes,
} from '@module-federation/enhanced/runtime';
import type { ComponentType } from 'react';
import {
  exposes,
  type ExposedModule,
  type ExposedName,
  type MountModule,
  type RemoteName,
  type RemoteOfKind,
} from '../../../federation.contract.ts';
import { fallbackPlugin } from './fallbackPlugin.ts';
import { resolveRemote, stableUrls as urls, type Resolved } from './registry.ts';

type PageModule = ExposedModule<ComponentType>;

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

// The manifest picked by hand in the inspector (RFC 0004); wins over the registry. In memory only.
const selected = new Map<RemoteName, string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

// The remote registry (RFC 0017): fetched once at boot, fail open to stable on any failure.
const registry = new Map<string, RegistryRow>();
let registryUp: boolean | null = null; // null = not answered yet
let registryRequest: Promise<void> | undefined;
// Canary remotes that failed to load: stable for the rest of this page session.
const fellBack = new Set<RemoteName>();
// What each remote is registered with in the MF runtime right now.
const registered = new Map<RemoteName, string>(
  (Object.keys(urls) as RemoteName[]).map((n) => [n, urls[n]]),
);

const REGISTRY_TIMEOUT_MS = 2000;

export function ensureRegistry(): Promise<void> {
  registryRequest ??= Promise.race([
    getRegistry(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('registry timeout')), REGISTRY_TIMEOUT_MS),
    ),
  ]).then(
    (rows) => {
      registry.clear();
      rows.forEach((r) => registry.set(r.name, r));
      registryUp = true;
      notify();
    },
    () => {
      registryUp = false;
      notify();
    },
  );
  return registryRequest;
}

// null until the boot fetch answered; false = unreachable, every remote is stable.
export const registryAvailable = (): boolean | null => registryUp;
export const registryRow = (name: RemoteName): RegistryRow | undefined => registry.get(name);

// After an admin PATCH: takes effect on the next load of that remote, not as a hot swap.
export function applyRegistryRow(row: RegistryRow): void {
  registry.set(row.name, row);
  notify();
}

export type Shown = Resolved['variant'] | 'fallback';

export function describeRemote(name: RemoteName): {
  shown: Shown;
  entry: string;
  bucket: number | null;
} {
  const user = getState().user;
  const r = resolveRemote(name, registry.get(name), user?.id ?? null);
  const picked = selected.get(name);
  if (picked) return { shown: 'stable', entry: picked, bucket: r.bucket };
  if (fellBack.has(name) && r.variant === 'canary') {
    return { shown: 'fallback', entry: urls[name], bucket: r.bucket };
  }
  return { shown: r.variant, entry: r.entry, bucket: r.bucket };
}

export const remoteEntry = (name: RemoteName): string => describeRemote(name).entry;
export const registryVersion = (): string =>
  JSON.stringify([registryUp, [...registry.values()], [...fellBack]]);

function register(name: RemoteName, entry: string): void {
  // preloadRemote (the idle prefetch) leaves the old entry's container on `globalThis[name]` without a
  // cached Module, so removeRemote does not clear it and the runtime would reuse the old container for
  // the new entry (a canary would silently load stable). Every remote's global name is its own name.
  if (registered.get(name) !== entry) Reflect.set(globalThis, name, undefined);
  registered.set(name, entry);
  registerRemotes([{ name, entry }], { force: true });
}

// Canary failed to load: stable for this page session. false = nothing to fall back from (called by the plugin).
function fallBackToStable(name: string): boolean {
  if (!(name in urls)) return false;
  const n = name as RemoteName;
  if (selected.has(n) || fellBack.has(n) || describeRemote(n).shown !== 'canary') return false;
  fellBack.add(n);
  register(n, urls[n]);
  notify();
  return true;
}

registerPlugins([fallbackPlugin(fallBackToStable)]);

// null = back to the default. Re-registers with force so the next loadPage fetches the new manifest.
export function setRemoteEntry(name: RemoteName, manifestUrl: string | null): void {
  if (manifestUrl === null) selected.delete(name);
  else selected.set(name, manifestUrl);
  register(name, remoteEntry(name));
  failed.delete(name);
  notify();
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

// A switched-off remote is never fetched: the frame shows its own state instead of an error.
export class RemoteDisabledError extends Error {}

async function load<M>(name: RemoteName, module: string): Promise<M> {
  await ensureRegistry();
  const { shown, entry } = describeRemote(name);
  if (shown === 'disabled' && !selected.has(name)) throw new RemoteDisabledError(name);
  // The runtime caches a failed manifest/entry fetch, so after a failure re-register the
  // remote with force: that drops the cached state and the next loadRemote refetches.
  if (failed.has(name) || registered.get(name) !== entry) {
    // A preload still in flight would write the old manifest back over the new registration.
    await prefetching;
    register(name, entry);
  }
  try {
    const mod = await loadRemote<M>(`${name}/${module}`);
    if (!mod) throw new Error(`${name} returned no module`);
    failed.delete(name);
    return mod;
  } catch (err) {
    failed.add(name);
    throw err;
  }
}

// Typed per kind (RFC 0016): loadPage only takes React remotes, loadMount only `mount` remotes, so
// loading a remote as the wrong kind does not compile.
export const loadPage = <R extends RemoteOfKind<'react'>>(
  name: R,
  module: ExposedName<R> = entries[name].module,
): Promise<PageModule> => load<PageModule>(name, module);

export const loadMount = <R extends RemoteOfKind<'mount'>>(
  name: R,
  module: ExposedName<R> = entries[name].module,
): Promise<MountModule> => load<MountModule>(name, module);

let prefetching: Promise<void> | undefined;

// Warm the browser cache with every enabled remote (manifest, entry, expose chunks incl. async) once per
// page load, from the entry it resolves to now. Disabled remotes are skipped (RFC 0017).
export function prefetchRemotes(): Promise<void> {
  prefetching ??= (async () => {
    await ensureRegistry();
    const names = (Object.keys(entries) as RemoteName[]).filter(
      (n) => describeRemote(n).shown !== 'disabled',
    );
    for (const n of names) {
      const { entry } = describeRemote(n);
      if (registered.get(n) !== entry) register(n, entry);
    }
    try {
      await preloadRemote(
        names.map((name) => ({
          nameOrAlias: name,
          exposes: [`./${entries[name].module}`],
          resourceCategory: 'all' as const,
        })),
      );
    } catch (err) {
      console.warn('prefetchRemotes failed', err);
    }
  })();
  return prefetching;
}

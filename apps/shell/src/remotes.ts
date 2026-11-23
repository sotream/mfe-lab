import { getRegistry, type RegistryRow } from '@mfe/api-client';
import { getState, subscribe } from '@mfe/auth-store';
import { report } from '@mfe/telemetry';
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

export const stableUrl = (name: RemoteName): string => urls[name];

export type { ExposedName, RemoteName };
// Where a remote lives, for the frame label: ":port" on localhost, else the first DNS label (full host in the label title).
export function remoteOrigin(manifestUrl: string): string {
  const { hostname, port } = new URL(manifestUrl);
  return hostname === 'localhost' || hostname === '127.0.0.1'
    ? `:${port}`
    : hostname.split('.')[0]!;
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
// A canary that has not loaded by then counts as failed (stable has a skeleton and Retry instead).
const CANARY_TIMEOUT_MS = 5000;
// load() waits for the idle prefetch at most this long.
const PREFETCH_WAIT_MS = 1000;

const timeout = (ms: number, what: string) =>
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error(what)), ms));

export function ensureRegistry(): Promise<void> {
  registryRequest ??= Promise.race([
    getRegistry(),
    timeout(REGISTRY_TIMEOUT_MS, 'registry timeout'),
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
  if (shown === 'disabled') throw new RemoteDisabledError(name);
  // The runtime caches a failed manifest/entry fetch, so after a failure re-register the
  // remote with force: that drops the cached state and the next loadRemote refetches.
  if (failed.has(name) || registered.get(name) !== entry) {
    // A preload still in flight would write the old manifest back over the new registration.
    await Promise.race([prefetching, timeout(PREFETCH_WAIT_MS, 'prefetch wait')]).catch(() => {});
    register(name, entry);
  }
  const canary = shown === 'canary';
  try {
    const request = loadRemote<M>(`${name}/${module}`);
    const mod = await (canary
      ? Promise.race([request, timeout(CANARY_TIMEOUT_MS, 'canary timeout')])
      : request);
    if (!mod) throw new Error(`${name} returned no module`);
    failed.delete(name);
    return mod;
  } catch (err) {
    // A canary that hangs never reaches the plugin, so fall back here, with the same report.
    if (
      canary &&
      err instanceof Error &&
      err.message === 'canary timeout' &&
      fallBackToStable(name)
    ) {
      report({
        remote: name,
        build: 'canary',
        kind: 'load',
        message: 'canary failed, fell back to stable: timed out after 5 s',
      });
      return load<M>(name, module);
    }
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
// The entry each remote was last warmed from.
const warmed = new Map<RemoteName, string>();

// Warm the browser cache (manifest, entry, expose chunks incl. async) of every enabled remote from the
// entry it resolves to now: canary or stable per the registry and the user's bucket. Disabled remotes
// are skipped (RFC 0017); a remote already warmed from the same entry is skipped too. Orders goes last.
async function warm(): Promise<void> {
  await ensureRegistry();
  const todo = (Object.keys(entries) as RemoteName[]).filter((n) => {
    const { shown, entry } = describeRemote(n);
    return shown !== 'disabled' && warmed.get(n) !== entry;
  });
  if (todo.length === 0) return;
  for (const n of todo) {
    const { entry } = describeRemote(n);
    warmed.set(n, entry);
    if (registered.get(n) !== entry) register(n, entry);
  }
  const preload = async (names: RemoteName[]) => {
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
  };
  // Orders (the heaviest) only starts once products and dashboard are done, so it never competes
  // with the remotes the user is most likely to open first.
  await preload(todo.filter((n) => n !== 'orders'));
  if (todo.includes('orders')) await preload(['orders']);
}

// Once per page load, at idle. The user is usually anonymous then, so it warms stable; a later sign-in
// warms the canary entries that user resolves to.
export function prefetchRemotes(): Promise<void> {
  prefetching ??= warm();
  return prefetching;
}

let warmedFor: number | undefined;
subscribe(() => {
  const id = getState().user?.id;
  if (prefetching && id !== undefined && id !== warmedFor) {
    warmedFor = id;
    prefetching = prefetching.then(warm);
  }
});

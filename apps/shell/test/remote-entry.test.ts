import { beforeEach, describe, expect, it, vi } from 'vitest';

const rt = vi.hoisted(() => ({
  registerRemotes: vi.fn(),
  loadRemote: vi.fn(),
  init: vi.fn(),
}));
vi.mock('@module-federation/enhanced/runtime', () => ({
  getInstance: () => null,
  registerPlugins: vi.fn(),
  init: rt.init,
  registerRemotes: rt.registerRemotes,
  loadRemote: rt.loadRemote,
}));

import {
  loadPage,
  releaseManifestUrl,
  releasesUrl,
  remoteEntry,
  setRemoteEntry,
  subscribeRemotes,
} from '../src/remotes.ts';

const PRODUCTS = 'http://localhost:3001/mf-manifest.json';
const DASHBOARD = 'http://localhost:3002/mf-manifest.json';
const V1 = 'http://localhost:3001/releases/1.0.0/mf-manifest.json';

beforeEach(() => {
  setRemoteEntry('products', null);
  setRemoteEntry('dashboard', null);
  vi.clearAllMocks();
  rt.loadRemote.mockResolvedValue({ default: () => null });
});

describe('remote entry selection', () => {
  it('Q-remote-entry: default is the build-time URL', () => {
    expect(remoteEntry('products')).toBe(PRODUCTS);
    expect(remoteEntry('dashboard')).toBe(DASHBOARD);
  });

  it('Q-remote-entry: setRemoteEntry changes entry, force-registers, notifies; null resets', () => {
    const listener = vi.fn();
    const unsub = subscribeRemotes(listener);
    setRemoteEntry('products', V1);
    expect(remoteEntry('products')).toBe(V1);
    expect(remoteEntry('dashboard')).toBe(DASHBOARD);
    expect(rt.registerRemotes).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'products', entry: V1 })],
      { force: true },
    );
    expect(listener).toHaveBeenCalledTimes(1);

    setRemoteEntry('products', null);
    expect(remoteEntry('products')).toBe(PRODUCTS);
    expect(rt.registerRemotes).toHaveBeenLastCalledWith(
      [expect.objectContaining({ name: 'products', entry: PRODUCTS })],
      { force: true },
    );
    expect(listener).toHaveBeenCalledTimes(2);

    unsub();
    setRemoteEntry('products', V1);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('Q-remote-entry: loadPage after a switch registers the new entry then calls loadRemote', async () => {
    setRemoteEntry('products', V1);
    await loadPage('products');
    expect(rt.loadRemote).toHaveBeenCalledTimes(1);
    const regOrders = rt.registerRemotes.mock.invocationCallOrder;
    const loadOrder = rt.loadRemote.mock.invocationCallOrder[0] as number;
    expect(regOrders.some((o) => o < loadOrder)).toBe(true);
    const last = rt.registerRemotes.mock.calls.at(-1) as [{ name: string; entry: string }[]];
    expect(last[0]).toEqual([expect.objectContaining({ name: 'products', entry: V1 })]);
  });

  it('Q-remote-entry: releasesUrl and releaseManifestUrl', () => {
    expect(releasesUrl('products')).toBe('http://localhost:3001/releases/index.json');
    expect(releasesUrl('dashboard')).toBe('http://localhost:3002/releases/index.json');
    expect(releaseManifestUrl('products', '1.0.0')).toBe(V1);
    expect(releaseManifestUrl('dashboard', '2.0.0-rc.1')).toBe(
      'http://localhost:3002/releases/2.0.0-rc.1/mf-manifest.json',
    );
  });
});

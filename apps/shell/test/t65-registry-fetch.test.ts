// T65: the boot registry fetch must stay CDN-cacheable for anonymous users.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@module-federation/enhanced/runtime', () => ({
  getInstance: () => null,
  init: vi.fn(),
  registerPlugins: vi.fn(),
  registerRemotes: vi.fn(),
  loadRemote: vi.fn(),
  preloadRemote: vi.fn(),
}));

const rows = ['dashboard', 'orders', 'products'].map((name) => ({
  name,
  canaryUrl: null,
  canaryPercent: 0,
  disabled: false,
}));
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  fetchMock = vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('boot registry fetch', () => {
  it('Q-registry-cache: anonymous fetch has no no-store, no bust param, no authorization', async () => {
    const { ensureRegistry, registryAvailable } = await import('../src/remotes.ts');
    await ensureRegistry();
    expect(registryAvailable()).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(new URL(url, 'http://x').pathname).toBe('/api/registry');
    expect(new URL(url, 'http://x').search).toBe('');
    expect(init?.cache).toBeUndefined(); // T65: shape may need adapting in phase 2 ('default' also fine)
    const headers = new Headers(init?.headers);
    expect(headers.has('authorization')).toBe(false);
    expect(headers.get('cache-control')).toBeNull();
    expect(headers.get('pragma')).toBeNull();
  });

  it('Q-registry-cache: the registry is fetched once per page session', async () => {
    const { ensureRegistry } = await import('../src/remotes.ts');
    await ensureRegistry();
    await ensureRegistry();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

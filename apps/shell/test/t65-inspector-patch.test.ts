// T65: after an admin PATCH the shell state comes from the PATCH response, not a (CDN-cached) re-read.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@module-federation/enhanced/runtime', () => ({
  getInstance: () => null,
  init: vi.fn(),
  registerPlugins: vi.fn(),
  registerRemotes: vi.fn(),
  loadRemote: vi.fn(),
  preloadRemote: vi.fn(),
}));

const stale = ['dashboard', 'orders', 'products'].map((name) => ({
  name,
  canaryUrl: null,
  canaryPercent: 0,
  disabled: false,
}));
const updated = {
  ...stale[2]!,
  canaryUrl: 'http://localhost:3001/releases/2.0.0/mf-manifest.json',
  canaryPercent: 40,
};
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  // GET /registry keeps answering the stale CDN copy; PATCH answers the fresh row.
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'PATCH'
      ? new Response(JSON.stringify(updated), { status: 200 })
      : new Response(JSON.stringify(stale), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('inspector registry edit', () => {
  it('Q-registry-cache: the PATCH response shows immediately despite a stale GET', async () => {
    const remotes = await import('../src/remotes.ts');
    const { updateRegistry } = await import('@mfe/api-client');
    await remotes.ensureRegistry();
    expect(remotes.registryRow('products')?.canaryPercent).toBe(0);

    remotes.applyRegistryRow(await updateRegistry('products', { canaryPercent: 40 }));

    expect(remotes.registryRow('products')).toMatchObject({ canaryPercent: 40 });
    const gets = fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === 'GET');
    expect(gets).toHaveLength(1); // only the boot read; no refetch after the PATCH
  });
});

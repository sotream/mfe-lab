import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getRegistry: vi.fn(),
  plugins: [] as unknown[],
  user: null as { id: number } | null,
  registerRemotes: vi.fn(),
  loadRemote: vi.fn(),
  preloadRemote: vi.fn(),
}));
vi.mock('@mfe/api-client', async (orig) => ({
  ...(await orig<object>()),
  getRegistry: h.getRegistry,
}));
vi.mock('@mfe/auth-store', async (orig) => ({
  ...(await orig<object>()),
  getState: () => ({ user: h.user, token: null, status: 'anonymous' }),
}));
vi.mock('@module-federation/enhanced/runtime', () => ({
  getInstance: () => null,
  init: vi.fn(),
  registerPlugins: (p: unknown[]) => h.plugins.push(...p),
  registerRemotes: h.registerRemotes,
  loadRemote: h.loadRemote,
  preloadRemote: h.preloadRemote,
}));

import { bucket, resolveRemote } from '../src/registry.ts';

type Row = { name: string; canaryUrl: string | null; canaryPercent: number; disabled: boolean };
const CANARY = 'http://localhost:3001/releases/2.0.0/mf-manifest.json';
const STABLE = 'http://localhost:3001/mf-manifest.json';
const row = (o: Partial<Row> = {}): Row => ({
  name: 'products',
  canaryUrl: CANARY,
  canaryPercent: 100,
  disabled: false,
  ...o,
});

describe('bucket', () => {
  it('Q-bucket: deterministic and in 0..99', () => {
    for (let id = 1; id <= 200; id++) {
      const b = bucket(id, 'products');
      expect(b).toBe(bucket(id, 'products'));
      expect(Number.isInteger(b)).toBe(true);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(99);
    }
  });

  it('Q-bucket: remotes bucket independently for the same user', () => {
    let differ = 0;
    for (let id = 1; id <= 50; id++)
      if (bucket(id, 'products') !== bucket(id, 'dashboard')) differ++;
    expect(differ).toBeGreaterThan(35); // not all equal; ~99% expected to differ
  });

  it('Q-bucket: about 30% of 10000 users are below 30', () => {
    let below = 0;
    for (let id = 1; id <= 10_000; id++) if (bucket(id, 'products') < 30) below++;
    expect(below / 10_000).toBeGreaterThanOrEqual(0.27);
    expect(below / 10_000).toBeLessThanOrEqual(0.33);
  });
});

describe('resolveRemote', () => {
  const userAt = (b: number): number => {
    for (let id = 1; id < 100_000; id++) if (bucket(id, 'products') === b) return id;
    throw new Error(`no user with bucket ${b}`);
  };

  it.each([
    ['disabled wins over a 100% canary', row({ disabled: true }), 1, 'disabled'],
    ['no canary URL is stable', row({ canaryUrl: null }), 1, 'stable'],
    ['percent 0 is stable', row({ canaryPercent: 0 }), 1, 'stable'],
    ['percent 100 is canary', row({ canaryPercent: 100 }), 1, 'canary'],
    ['anonymous is stable', row({ canaryPercent: 100 }), null, 'stable'],
    ['no registry row is stable', undefined, 1, 'stable'],
  ] as const)('Q-resolve: %s', (_t, r, user, variant) => {
    const res = resolveRemote('products', r, user);
    expect(res.variant).toBe(variant);
    if (variant === 'canary') expect(res.entry).toBe(CANARY);
    if (variant === 'stable') expect(res.entry).toBe(STABLE);
  });

  it('Q-resolve: the threshold is exact (bucket = percent - 1 in, percent out)', () => {
    for (const percent of [1, 30, 99]) {
      const r = row({ canaryPercent: percent });
      expect(resolveRemote('products', r, userAt(percent - 1)).variant).toBe('canary');
      expect(resolveRemote('products', r, userAt(percent)).variant).toBe('stable');
    }
  });

  it('Q-resolve: reports the user bucket, null when anonymous', () => {
    expect(resolveRemote('products', row(), 7).bucket).toBe(bucket(7, 'products'));
    expect(resolveRemote('products', row(), null).bucket).toBeNull();
  });
});

const fresh = async () => {
  vi.resetModules();
  h.plugins.length = 0;
  return import('../src/remotes.ts');
};

beforeEach(() => {
  vi.clearAllMocks();
  h.user = null;
  h.preloadRemote.mockResolvedValue(undefined);
  h.loadRemote.mockResolvedValue({ default: () => null });
});

describe('boot', () => {
  it('Q-boot-fail-open: a rejected registry fetch resolves, every remote is stable', async () => {
    h.getRegistry.mockRejectedValue(new Error('network down'));
    const r = await fresh();
    h.user = { id: 1 };
    await expect(r.ensureRegistry()).resolves.toBeUndefined();
    expect(r.registryAvailable()).toBe(false);
    for (const n of ['products', 'dashboard', 'orders'] as const)
      expect(r.describeRemote(n).shown).toBe('stable');
    await expect(r.loadPage('products')).resolves.toBeDefined(); // no error, no disabled state
  });

  it('Q-boot-fail-open: a hanging registry fetch times out (about 2 s) and fails open', async () => {
    vi.useFakeTimers();
    try {
      h.getRegistry.mockReturnValue(new Promise(() => {}));
      const r = await fresh();
      let done = false;
      const p = r.ensureRegistry().then(() => (done = true));
      await vi.advanceTimersByTimeAsync(1500);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1000);
      await p;
      expect(r.registryAvailable()).toBe(false);
      expect(r.describeRemote('products').shown).toBe('stable');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Q-boot-fail-open: the registry is fetched once', async () => {
    h.getRegistry.mockResolvedValue([row({ canaryUrl: null, canaryPercent: 0 })]);
    const r = await fresh();
    await Promise.all([r.ensureRegistry(), r.ensureRegistry()]);
    await r.ensureRegistry();
    expect(h.getRegistry).toHaveBeenCalledTimes(1);
  });
});

describe('fallback once-only (through remotes.ts)', () => {
  type Plugin = {
    errorLoadRemote: (a: object) => Promise<unknown>;
  };
  const onLoad = (p: Plugin, id: string, error: unknown) =>
    p.errorLoadRemote({
      id,
      error,
      lifecycle: 'onLoad',
      origin: { loadRemote: h.loadRemote },
    });

  it('Q-fallback-plugin: canary failure re-registers stable once; a later failure is not swallowed', async () => {
    h.getRegistry.mockResolvedValue([row()]);
    const r = await fresh();
    h.user = { id: 1 };
    await r.ensureRegistry();
    expect(r.describeRemote('products')).toMatchObject({ shown: 'canary', entry: CANARY });
    const plugin = h.plugins[0] as Plugin;
    h.registerRemotes.mockClear();

    const stableMod = { default: 'stable' };
    h.loadRemote.mockResolvedValueOnce(stableMod);
    await expect(onLoad(plugin, 'products/ProductsPage', new Error('404'))).resolves.toBe(
      stableMod,
    );
    expect(h.registerRemotes).toHaveBeenCalledTimes(1);
    expect(h.registerRemotes).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'products', entry: STABLE })],
      { force: true },
    );
    expect(r.describeRemote('products')).toMatchObject({ shown: 'fallback', entry: STABLE });

    // stable fails too: surfaced (undefined), no second re-register
    h.registerRemotes.mockClear();
    await expect(
      onLoad(plugin, 'products/ProductsPage', new Error('stable down')),
    ).resolves.toBeUndefined();
    expect(h.registerRemotes).not.toHaveBeenCalled();
  });

  it('Q-fallback-plugin: a stable-only remote is left alone', async () => {
    h.getRegistry.mockResolvedValue([row({ canaryUrl: null, canaryPercent: 0 })]);
    const r = await fresh();
    h.user = { id: 1 };
    await r.ensureRegistry();
    h.registerRemotes.mockClear();
    await expect(
      onLoad(h.plugins[0] as Plugin, 'products/ProductsPage', new Error('x')),
    ).resolves.toBeUndefined();
    expect(h.registerRemotes).not.toHaveBeenCalled();
  });

  it('Q-kill-switch: a disabled remote throws RemoteDisabledError and is never loaded or prefetched', async () => {
    h.getRegistry.mockResolvedValue([row({ disabled: true })]);
    const r = await fresh();
    h.user = { id: 1 };
    await r.ensureRegistry();
    await expect(r.loadPage('products')).rejects.toBeInstanceOf(r.RemoteDisabledError);
    expect(h.loadRemote).not.toHaveBeenCalled();
    await r.prefetchRemotes();
    const names = h.preloadRemote.mock.calls.flatMap((c) =>
      (c[0] as { nameOrAlias: string }[]).map((e) => e.nameOrAlias),
    );
    expect(names).toEqual(['dashboard', 'orders']);
  });
});

describe('resolveRemote trust (T46)', () => {
  // Q-resolve-ignores-bad-row: rows written before the fix must not load foreign scripts.
  it.each([
    'https://evil.example/mf-manifest.json',
    'https://mfe-lab.vercel.app@evil.example/mf-manifest.json',
    'https://mfe-lab-products-pr-12.vercel.app.evil.example/mf-manifest.json',
    'http://evil.example/mf-manifest.json',
    'https://mfe-lab-products.vercel.app/evil.js',
  ])('Q-resolve-ignores-bad-row: %s at 100%% resolves to stable', (canaryUrl) => {
    const res = resolveRemote('products', row({ canaryUrl, canaryPercent: 100 }), 1);
    expect(res.variant).toBe('stable');
    expect(res.entry).toBe(STABLE);
  });

  it('Q-resolve-ignores-bad-row: an allowed canary (localhost in tests) still resolves to canary', () => {
    expect(resolveRemote('products', row({ canaryPercent: 100 }), 1)).toMatchObject({
      variant: 'canary',
      entry: CANARY,
    });
  });
});

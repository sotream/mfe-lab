import { beforeEach, describe, expect, it, vi } from 'vitest';

// T63: warm() preloads products + dashboard first, orders only after that settles.
const rt = vi.hoisted(() => ({
  registerRemotes: vi.fn(),
  loadRemote: vi.fn(),
  preloadRemote: vi.fn(),
  getRegistry: vi.fn(),
}));
vi.mock('@mfe/api-client', async (orig) => ({
  ...(await orig<object>()),
  getRegistry: rt.getRegistry,
}));
vi.mock('@module-federation/enhanced/runtime', () => ({
  getInstance: () => null,
  registerPlugins: vi.fn(),
  init: vi.fn(),
  registerRemotes: rt.registerRemotes,
  loadRemote: rt.loadRemote,
  preloadRemote: rt.preloadRemote,
}));

const fresh = async () => {
  vi.resetModules();
  const mod = await import('../src/remotes.ts');
  vi.clearAllMocks();
  return mod;
};
const flush = () => new Promise((r) => setTimeout(r, 0));
const names = (call: unknown[]) =>
  (call[0] as { nameOrAlias: string }[]).map((r) => r.nameOrAlias).sort();

beforeEach(() => {
  vi.resetAllMocks();
  rt.getRegistry.mockRejectedValue(new Error('no registry')); // fail open: all stable
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('prefetch order', () => {
  it('Q-t63-warm: orders is requested only after products+dashboard resolve', async () => {
    let release!: () => void;
    const { prefetchRemotes } = await fresh();
    rt.preloadRemote.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    rt.preloadRemote.mockResolvedValue(undefined);
    const done = prefetchRemotes();
    await flush();
    expect(rt.preloadRemote).toHaveBeenCalledTimes(1);
    expect(names(rt.preloadRemote.mock.calls[0]!)).toEqual(['dashboard', 'products']);
    release();
    await done;
    expect(rt.preloadRemote).toHaveBeenCalledTimes(2);
    expect(names(rt.preloadRemote.mock.calls[1]!)).toEqual(['orders']);
  });

  it('Q-t63-warm: orders is still requested after products+dashboard reject', async () => {
    const { prefetchRemotes } = await fresh();
    rt.preloadRemote.mockRejectedValueOnce(new Error('boom'));
    rt.preloadRemote.mockResolvedValue(undefined);
    await prefetchRemotes();
    expect(rt.preloadRemote).toHaveBeenCalledTimes(2);
    expect(names(rt.preloadRemote.mock.calls[1]!)).toEqual(['orders']);
  });

  it('Q-t63-warm: a disabled orders remote is never requested', async () => {
    rt.getRegistry.mockResolvedValue([
      { name: 'orders', canaryUrl: null, canaryPercent: 0, disabled: true },
    ]);
    const { prefetchRemotes } = await fresh();
    rt.preloadRemote.mockResolvedValue(undefined);
    await prefetchRemotes();
    const all = rt.preloadRemote.mock.calls.flatMap((c) => names(c));
    expect(all.sort()).toEqual(['dashboard', 'products']);
  });
});

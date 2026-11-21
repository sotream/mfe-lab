import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rt = vi.hoisted(() => ({
  registerRemotes: vi.fn(),
  loadRemote: vi.fn(),
  preloadRemote: vi.fn(),
  init: vi.fn(),
}));
vi.mock('@module-federation/enhanced/runtime', () => ({
  getInstance: () => null,
  init: rt.init,
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

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  rt.preloadRemote.mockResolvedValue(undefined);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe('prefetchRemotes', () => {
  it('Q-prefetch: calls preloadRemote once with all remotes', async () => {
    const { prefetchRemotes } = await fresh();
    prefetchRemotes();
    expect(rt.preloadRemote).toHaveBeenCalledTimes(1);
    expect(rt.preloadRemote).toHaveBeenCalledWith([
      { nameOrAlias: 'products', exposes: ['./ProductsPage'], resourceCategory: 'all' },
      { nameOrAlias: 'dashboard', exposes: ['./DashboardPage'], resourceCategory: 'all' },
      { nameOrAlias: 'orders', exposes: ['./OrdersApp'], resourceCategory: 'all' },
    ]);
  });

  it('Q-prefetch: second call in the same module instance is a no-op', async () => {
    const { prefetchRemotes } = await fresh();
    prefetchRemotes();
    prefetchRemotes();
    expect(rt.preloadRemote).toHaveBeenCalledTimes(1);
  });

  it('Q-prefetch: a fresh module instance prefetches again', async () => {
    const a = await fresh();
    a.prefetchRemotes();
    const b = await fresh();
    b.prefetchRemotes();
    expect(rt.preloadRemote).toHaveBeenCalledTimes(1);
  });

  it('Q-prefetch: rejected preloadRemote does not throw, warns after settle', async () => {
    rt.preloadRemote.mockRejectedValue(new Error('boom'));
    const { prefetchRemotes } = await fresh();
    rt.preloadRemote.mockRejectedValue(new Error('boom'));
    expect(() => prefetchRemotes()).not.toThrow();
    await Promise.resolve();
    await flush();
    expect(warn).toHaveBeenCalled();
  });

  it('Q-prefetch: synchronous throw does not escape, warns', async () => {
    const { prefetchRemotes } = await fresh();
    rt.preloadRemote.mockImplementation(() => {
      throw new Error('sync boom');
    });
    expect(() => prefetchRemotes()).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });

  it('Q-prefetch: does not call registerRemotes itself', async () => {
    const { prefetchRemotes, setRemoteEntry } = await fresh();
    setRemoteEntry('products', 'http://localhost:3001/releases/1.0.0/mf-manifest.json');
    rt.registerRemotes.mockClear();
    prefetchRemotes();
    await flush();
    expect(rt.registerRemotes).not.toHaveBeenCalled();
  });
});

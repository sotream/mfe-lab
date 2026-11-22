// T49: Q-canary-timeout (M6), M7 (load waits for the idle prefetch at most 1 s), M10 (prefetch warms the
// resolved entry). ASSUMPTION: the 5 s canary timeout covers the whole loadRemote of a canary, and the
// fallback goes through the same path as a failed canary (describeRemote shows `fallback`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getRegistry: vi.fn(),
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
  registerPlugins: vi.fn(),
  registerRemotes: h.registerRemotes,
  loadRemote: h.loadRemote,
  preloadRemote: h.preloadRemote,
}));
vi.mock('@mfe/telemetry', () => ({ report: vi.fn() }));

const CANARY = 'http://localhost:3001/releases/2.0.0/mf-manifest.json';
const CANARY_2 = 'http://localhost:3001/releases/3.0.0/mf-manifest.json';
const STABLE = 'http://localhost:3001/mf-manifest.json';
const row = (canaryUrl = CANARY) => ({
  name: 'products',
  canaryUrl,
  canaryPercent: 100,
  disabled: false,
});
const never = () => new Promise<never>(() => {});
const stableMod = { default: 'stable' };

const fresh = async () => {
  vi.resetModules();
  const r = await import('../src/remotes.ts');
  vi.clearAllMocks();
  return r;
};

beforeEach(() => {
  vi.useFakeTimers();
  h.user = { id: 1 };
  h.getRegistry.mockResolvedValue([row()]);
  h.preloadRemote.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe('Q-canary-timeout', () => {
  it('a canary that never loads falls back to stable within about 5 s, variant fell back', async () => {
    const r = await fresh();
    await r.ensureRegistry();
    expect(r.describeRemote('products').shown).toBe('canary');
    // First load (the canary) hangs forever; once stable is registered the load answers.
    h.loadRemote.mockImplementationOnce(never).mockResolvedValue(stableMod);
    let result: unknown;
    const p = r.loadPage('products').then((m) => (result = m));
    await vi.advanceTimersByTimeAsync(4500);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000);
    void p; // not awaited: with the bug it never settles and would hang the test
    expect(result).toBe(stableMod);
    expect(r.describeRemote('products')).toMatchObject({ shown: 'fallback', entry: STABLE });
    expect(h.registerRemotes).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'products', entry: STABLE })],
      { force: true },
    );
  });

  it('a stable load has no timeout: it can take longer than 5 s and still resolves', async () => {
    h.getRegistry.mockResolvedValue([{ ...row(), canaryUrl: null, canaryPercent: 0 }]);
    const r = await fresh();
    await r.ensureRegistry();
    let resolve!: (m: unknown) => void;
    h.loadRemote.mockImplementationOnce(() => new Promise((res) => (resolve = res)));
    let result: unknown;
    let error: unknown;
    const p = r.loadPage('products').then(
      (m) => (result = m),
      (e) => (error = e),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(error).toBeUndefined();
    expect(r.describeRemote('products').shown).toBe('stable');
    resolve(stableMod);
    await p;
    expect(result).toBe(stableMod);
  });

  it('a canary that loads in time is kept', async () => {
    const r = await fresh();
    await r.ensureRegistry();
    h.loadRemote.mockResolvedValueOnce({ default: 'canary' });
    await expect(r.loadPage('products')).resolves.toEqual({ default: 'canary' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(r.describeRemote('products').shown).toBe('canary');
  });
});

describe('M7: load waits for the idle prefetch for at most 1 s', () => {
  it('a hanging preload does not block load() longer than 1 s', async () => {
    const r = await fresh();
    await r.ensureRegistry();
    h.preloadRemote.mockImplementation(never);
    void r.prefetchRemotes();
    await vi.advanceTimersByTimeAsync(0);
    // The registry changes after the prefetch registered its entry: load() re-registers and waits for the preload.
    r.applyRegistryRow(row(CANARY_2));
    h.loadRemote.mockResolvedValue({ default: 'canary2' });
    let result: unknown;
    const p = r.loadPage('products').then((m) => (result = m));
    await vi.advanceTimersByTimeAsync(900);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(300);
    void p;
    expect(result).toEqual({ default: 'canary2' });
  });
});

describe('M10: the idle prefetch warms the resolved entry', () => {
  it('a signed-in user in the canary bucket warms the canary entry', async () => {
    const r = await fresh();
    await r.prefetchRemotes();
    expect(h.registerRemotes).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'products', entry: CANARY })],
      expect.anything(),
    );
  });

  it('an anonymous user warms stable', async () => {
    h.user = null;
    const r = await fresh();
    await r.prefetchRemotes();
    const entries = h.registerRemotes.mock.calls.flatMap((c) =>
      (c[0] as { name: string; entry: string }[]).filter((e) => e.name === 'products'),
    );
    expect(entries.every((e) => e.entry === STABLE)).toBe(true);
    expect(h.preloadRemote).toHaveBeenCalledTimes(1);
  });
});

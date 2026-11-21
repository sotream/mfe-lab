import { beforeEach, describe, expect, it, vi } from 'vitest';

const tel = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock('@mfe/telemetry', () => ({ report: tel.report }));

import { fallbackPlugin } from '../src/fallbackPlugin.ts';

const mod = { default: 'stable-module' };

function setup(fallBack: (r: string) => boolean = () => true) {
  const fb = vi.fn(fallBack);
  const loadRemote = vi.fn(async () => mod);
  const plugin = fallbackPlugin(fb) as unknown as {
    name: string;
    errorLoadRemote: (a: object) => Promise<unknown>;
  };
  const fail = (
    id = 'products/ProductsPage',
    error: unknown = new Error('404'),
    lifecycle = 'onLoad',
  ) => plugin.errorLoadRemote({ id, error, lifecycle, origin: { loadRemote } });
  return { plugin, fb, fail, loadRemote };
}

beforeEach(() => vi.clearAllMocks());

describe('fallback plugin', () => {
  it('Q-fallback-plugin: is named mfe-canary-fallback', () => {
    expect(setup().plugin.name).toBe('mfe-canary-fallback');
  });

  it('Q-fallback-plugin: a failing canary yields the stable module', async () => {
    const t = setup();
    await expect(t.fail()).resolves.toBe(mod);
    expect(t.fb).toHaveBeenCalledWith('products');
    expect(t.loadRemote).toHaveBeenCalledWith('products/ProductsPage');
  });

  it('Q-fallback-plugin: telemetry is reported once with the remote name and reason', async () => {
    const t = setup();
    await t.fail('products/ProductsPage', new Error('boom'));
    expect(tel.report).toHaveBeenCalledTimes(1);
    expect(tel.report).toHaveBeenCalledWith({
      remote: 'products',
      build: 'canary',
      kind: 'load',
      message: 'canary failed, fell back to stable: boom',
    });
  });

  it('Q-fallback-plugin: when fallBack says no, the error is surfaced and nothing is reported', async () => {
    const t = setup(() => false);
    await expect(t.fail()).resolves.toBeUndefined();
    expect(tel.report).not.toHaveBeenCalled();
    expect(t.loadRemote).not.toHaveBeenCalled();
  });

  it('Q-fallback-plugin: only the final onLoad failure triggers a fallback', async () => {
    const t = setup();
    await expect(
      t.fail('products/ProductsPage', new Error('x'), 'afterResolve'),
    ).resolves.toBeUndefined();
    expect(t.fb).not.toHaveBeenCalled();
    expect(tel.report).not.toHaveBeenCalled();
  });

  it('Q-fallback-plugin: a failing stable retry rejects once, no loop', async () => {
    const t = setup();
    t.loadRemote.mockRejectedValueOnce(new Error('stable down'));
    await expect(t.fail()).rejects.toThrow('stable down');
    expect(t.loadRemote).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it } from 'vitest';
import { call, freshApp, type Ctx } from './helpers.ts';

type Flag = { name: string; enabled: boolean; description: string };

const list = async (ctx: Ctx) => {
  const res = await call(ctx, { url: '/flags', as: 'viewer' });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Flag[]>();
};

describe('flags', () => {
  it('Q-flags-api: GET needs auth', async () => {
    const ctx = await freshApp();
    expect((await call(ctx, { url: '/flags', as: null })).statusCode).toBe(401);
  });

  it('Q-flags-api: a viewer lists the 3 seeded flags, sorted, enabled is boolean', async () => {
    const flags = await list(await freshApp());
    expect(flags.map((f) => f.name)).toEqual([
      'dashboard.revenue',
      'products.crash',
      'products.detailPage',
    ]);
    expect(flags.map((f) => f.enabled)).toEqual([true, false, true]);
    for (const f of flags) {
      expect(Object.keys(f).sort()).toEqual(['description', 'enabled', 'name']);
      expect(typeof f.description).toBe('string');
    }
  });

  it('Q-flags-api: an editor and a viewer PATCH get 403', async () => {
    const ctx = await freshApp();
    for (const as of ['editor', 'viewer'] as const) {
      const res = await call(ctx, {
        method: 'PATCH',
        url: '/flags/products.crash',
        as,
        payload: { enabled: true },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'forbidden' });
    }
    expect((await list(ctx)).find((f) => f.name === 'products.crash')?.enabled).toBe(false);
  });

  it('Q-flags-api: an admin PATCH returns 200 and persists', async () => {
    const ctx = await freshApp();
    const res = await call(ctx, {
      method: 'PATCH',
      url: '/flags/products.crash',
      payload: { enabled: true },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ name: 'products.crash', enabled: true });
    expect((await list(ctx)).find((f) => f.name === 'products.crash')?.enabled).toBe(true);
  });

  it('Q-flags-api: an unknown name gives 404 not_found', async () => {
    const res = await call(await freshApp(), {
      method: 'PATCH',
      url: '/flags/nope',
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });

  it('Q-flags-api: a bad body gives 400', async () => {
    const ctx = await freshApp();
    for (const payload of [{ enabled: 'yes' }, {}, { enabled: true, extra: 1 }]) {
      const res = await call(ctx, { method: 'PATCH', url: '/flags/products.crash', payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });
});

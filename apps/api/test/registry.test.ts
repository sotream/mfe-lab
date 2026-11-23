import { describe, expect, it } from 'vitest';
import { seed } from '../src/seed.ts';
import { call, freshApp } from './helpers.ts';

type Row = { name: string; canaryUrl: string | null; canaryPercent: number; disabled: boolean };

const OK_URL = 'https://mfe-lab-products.vercel.app/releases/1.2.3/mf-manifest.json';
const patch = (ctx: Awaited<ReturnType<typeof freshApp>>, payload: object, name = 'products') =>
  call(ctx, { method: 'PATCH', url: `/registry/${name}`, payload });
const list = async (ctx: Awaited<ReturnType<typeof freshApp>>) =>
  (await call(ctx, { url: '/registry', as: null })).json<Row[]>();

describe('registry', () => {
  it('Q-registry-api: GET is public, returns the 3 seeded rows, CDN-cacheable', async () => {
    const ctx = await freshApp();
    const res = await call(ctx, { url: '/registry', as: null });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('public, s-maxage=5, stale-while-revalidate=60');
    const rows = res.json<Row[]>();
    expect(rows.map((r) => r.name)).toEqual(['dashboard', 'orders', 'products']);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(['canaryPercent', 'canaryUrl', 'disabled', 'name']);
      expect(r).toMatchObject({ canaryUrl: null, canaryPercent: 0, disabled: false });
    }
  });

  it('Q-registry-api: an admin PATCH updates, returns the row and persists', async () => {
    const ctx = await freshApp();
    const res = await patch(ctx, { canaryUrl: OK_URL, canaryPercent: 25, disabled: true });
    expect(res.statusCode, res.body).toBe(200);
    const want = { name: 'products', canaryUrl: OK_URL, canaryPercent: 25, disabled: true };
    expect(res.json()).toMatchObject(want);
    expect((await list(ctx)).find((r) => r.name === 'products')).toMatchObject(want);
    expect((await list(ctx)).find((r) => r.name === 'orders')).toMatchObject({
      canaryPercent: 0,
      disabled: false,
    });
  });

  it('Q-registry-api: a partial PATCH keeps the other fields; null clears the URL', async () => {
    const ctx = await freshApp();
    await patch(ctx, { canaryUrl: OK_URL, canaryPercent: 10 });
    await patch(ctx, { disabled: true });
    expect((await list(ctx)).find((r) => r.name === 'products')).toMatchObject({
      canaryUrl: OK_URL,
      canaryPercent: 10,
      disabled: true,
    });
    expect((await patch(ctx, { canaryUrl: null })).statusCode).toBe(200);
    expect((await list(ctx)).find((r) => r.name === 'products')?.canaryUrl).toBeNull();
  });

  it('Q-registry-api: localhost http URLs are accepted, 127.0.0.1 is not', async () => {
    const ctx = await freshApp();
    const local = 'http://localhost:3001/releases/1.0.0/mf-manifest.json';
    expect((await patch(ctx, { canaryUrl: local })).statusCode).toBe(200);
    // T46: 127.0.0.1 is no longer allowed.
    expect(
      (await patch(ctx, { canaryUrl: 'http://127.0.0.1:3001/mf-manifest.json' })).statusCode,
    ).toBe(400);
  });

  it('Q-registry-api: editor and viewer get 403, no token 401, row unchanged', async () => {
    const ctx = await freshApp();
    for (const as of ['editor', 'viewer'] as const) {
      const res = await call(ctx, {
        method: 'PATCH',
        url: '/registry/products',
        as,
        payload: { disabled: true },
      });
      expect(res.statusCode).toBe(403);
    }
    const anon = await call(ctx, {
      method: 'PATCH',
      url: '/registry/products',
      as: null,
      payload: { disabled: true },
    });
    expect(anon.statusCode).toBe(401);
    expect((await list(ctx)).find((r) => r.name === 'products')?.disabled).toBe(false);
  });

  it('Q-registry-api: an unknown name gives 404', async () => {
    const res = await patch(await freshApp(), { disabled: true }, 'nope');
    expect(res.statusCode).toBe(404);
  });

  it('Q-registry-api: a bad body gives 400 and leaks no DB detail', async () => {
    const ctx = await freshApp();
    const bad: object[] = [
      { canaryUrl: 'ftp://cdn.example.com/mf-manifest.json' },
      { canaryUrl: 'http://example.com/mf-manifest.json' },
      { canaryUrl: 'https://cdn.example.com/products/remoteEntry.js' },
      { canaryUrl: 'https://cdn.example.com/mf-manifest.json.evil' },
      { canaryUrl: 'not a url' },
      { canaryPercent: -1 },
      { canaryPercent: 101 },
      { canaryPercent: 1.5 },
      { canaryPercent: '5' },
      { disabled: 'yes' },
      { extra: 1 },
      { disabled: true, extra: 1 },
    ];
    for (const payload of bad) {
      const res = await patch(ctx, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.body).not.toMatch(
        /pg_|constraint|violates|SQL|relation|canary_percent|(?<![a-z_])canary_url/i,
      );
    }
    expect((await list(ctx)).find((r) => r.name === 'products')).toMatchObject({
      canaryUrl: null,
      canaryPercent: 0,
      disabled: false,
    });
  });

  it('Q-registry-api: seed reset clears canary and disabled', async () => {
    const ctx = await freshApp();
    await patch(ctx, { canaryUrl: OK_URL, canaryPercent: 40, disabled: true });
    await seed(ctx.app.db, { reset: true });
    const rows = await list(ctx);
    expect(rows.map((r) => r.name)).toEqual(['dashboard', 'orders', 'products']);
    for (const r of rows)
      expect(r).toMatchObject({ canaryUrl: null, canaryPercent: 0, disabled: false });
  });
});

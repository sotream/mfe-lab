import { afterAll, describe, expect, it, vi } from 'vitest';
import { call, count, freshApp, isIso, type Ctx } from './helpers.ts';

type Row = {
  id: number;
  remote: string;
  build: string;
  kind: string;
  message: string;
  stack: string | null;
  url: string;
  at: string;
};

const body = (o: Partial<Record<string, unknown>> = {}) => ({
  remote: 'products',
  build: 'b1',
  kind: 'render',
  message: 'boom',
  url: 'http://localhost:3000/',
  ...o,
});
const post = (ctx: Ctx, payload: object | string, headers?: Record<string, string>) =>
  call(ctx, { method: 'POST', url: '/errors', as: null, payload, headers });
// POST /errors is limited to 30 per minute per IP; trustProxy is on when VERCEL is set, so a bulk test
// spreads its posts over distinct x-forwarded-for addresses (25 per address).
vi.stubEnv('VERCEL', '1');
afterAll(() => vi.unstubAllEnvs());
const ip = (i: number) => ({
  'x-forwarded-for': `10.0.${Math.floor(i / 25 / 250)}.${Math.floor(i / 25) % 250}`,
});
const list = async (ctx: Ctx, query?: Record<string, string>) => {
  const res = await call(ctx, { url: '/errors', query });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Row[]>();
};

describe('errors api', () => {
  it('Q-errors-api: POST with no token gives 201 { id }, server sets at', async () => {
    const ctx = await freshApp();
    const res = await post(ctx, body());
    expect(res.statusCode, res.body).toBe(201);
    expect(typeof res.json<{ id: number }>().id).toBe('number');
    const [row] = await list(ctx);
    expect(row).toMatchObject({ remote: 'products', build: 'b1', kind: 'render', message: 'boom' });
    expect(isIso(row!.at)).toBe(true);
  });

  it('Q-errors-api: bad bodies give 400', async () => {
    const ctx = await freshApp();
    for (const bad of [
      body({ kind: 'nope' }),
      body({ remote: '' }),
      body({ remote: 'x'.repeat(41) }),
      body({ build: 'x'.repeat(81) }),
      body({ url: 'x'.repeat(501) }),
      { remote: 'products' },
    ])
      expect((await post(ctx, bad)).statusCode).toBe(400);
    expect(await count(ctx.app.db, 'errors')).toBe(0);
  });

  it('Q-errors-api: text/plain bodies are rejected with 400 (clients send application/json)', async () => {
    const ctx = await freshApp();
    const res = await post(ctx, JSON.stringify(body()), {
      'content-type': 'text/plain;charset=UTF-8',
    });
    expect(res.statusCode).toBe(400);
    expect(await count(ctx.app.db, 'errors')).toBe(0);
  });

  it('Q-errors-api: over-long message or stack gives 400 (T46 bounds 2000 and 8000), limits inclusive', async () => {
    const ctx = await freshApp();
    expect((await post(ctx, body({ message: 'm'.repeat(2001) }))).statusCode).toBe(400);
    expect((await post(ctx, body({ stack: 's'.repeat(8001) }))).statusCode).toBe(400);
    const res = await post(ctx, body({ message: 'm'.repeat(2000), stack: 's'.repeat(8000) }));
    expect(res.statusCode, res.body).toBe(201);
    const [row] = await list(ctx);
    expect(row!.message).toHaveLength(2000);
    expect(row!.stack).toHaveLength(8000);
  });

  it('Q-errors-api: GET is newest first, filters by remote', async () => {
    const ctx = await freshApp();
    await post(ctx, body({ message: 'one' }));
    await post(ctx, body({ remote: 'dashboard', message: 'two' }));
    await post(ctx, body({ message: 'three', kind: 'load' }));
    expect((await list(ctx)).map((r) => r.message)).toEqual(['three', 'two', 'one']);
    const only = await list(ctx, { remote: 'products' });
    expect(only.map((r) => r.message)).toEqual(['three', 'one']);
    expect(Object.keys(only[0]!).sort()).toEqual(
      ['at', 'build', 'id', 'kind', 'message', 'remote', 'stack', 'url'].sort(),
    );
  });

  it('Q-errors-api: GET returns at most 50', async () => {
    const ctx = await freshApp();
    for (let i = 0; i < 55; i++) await post(ctx, body({ message: `m${i}` }), ip(i));
    const rows = await list(ctx);
    expect(rows).toHaveLength(50);
    expect(rows[0]?.message).toBe('m54');
  });

  it('Q-errors-api: summary counts per remote', async () => {
    const ctx = await freshApp();
    await post(ctx, body());
    await post(ctx, body());
    await post(ctx, body({ remote: 'dashboard' }));
    const res = await call(ctx, { url: '/errors/summary' });
    expect(res.statusCode, res.body).toBe(200);
    const sum = res.json<{ remote: string; count: number }[]>();
    expect(sum.find((s) => s.remote === 'products')?.count).toBe(2);
    expect(sum.find((s) => s.remote === 'dashboard')?.count).toBe(1);
    expect(sum).toHaveLength(2);
  });

  it('Q-errors-api: DELETE gives 204, then the list is empty', async () => {
    const ctx = await freshApp();
    await post(ctx, body());
    expect((await call(ctx, { method: 'DELETE', url: '/errors' })).statusCode).toBe(204);
    expect(await list(ctx)).toEqual([]);
  });

  it('Q-errors-api: viewer and editor get 403, no token gets 401', async () => {
    const ctx = await freshApp();
    await post(ctx, body());
    for (const as of ['viewer', 'editor'] as const) {
      expect((await call(ctx, { url: '/errors', as })).statusCode).toBe(403);
      expect((await call(ctx, { url: '/errors/summary', as })).statusCode).toBe(403);
      expect((await call(ctx, { method: 'DELETE', url: '/errors', as })).statusCode).toBe(403);
    }
    expect((await call(ctx, { url: '/errors', as: null })).statusCode).toBe(401);
    expect((await call(ctx, { url: '/errors/summary', as: null })).statusCode).toBe(401);
    expect((await call(ctx, { method: 'DELETE', url: '/errors', as: null })).statusCode).toBe(401);
    expect(await count(ctx.app.db, 'errors')).toBe(1);
  });

  it('Q-errors-api: retention keeps the newest 1000', async () => {
    const ctx = await freshApp();
    for (let i = 0; i < 1005; i++) await post(ctx, body({ message: `m${i}` }), ip(i));
    expect(await count(ctx.app.db, 'errors')).toBe(1000);
    const messages = await ctx.app.db.query<{ message: string }>('SELECT message FROM errors');
    expect(messages.some((r) => r.message === 'm0')).toBe(false);
    expect(messages.some((r) => r.message === 'm1004')).toBe(true);
  }, 30_000);
});

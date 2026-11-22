// T49 review fixes: Q-stats-overflow, Q-update-race, Q-pool-error.
import { EventEmitter } from 'node:events';
import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../src/db.ts';
import { call, freshApp, type Ctx } from './helpers.ts';

afterEach(() => vi.restoreAllMocks());

const PRICE_MAX = 100_000_000; // EUR 1M in cents
const STOCK_MAX = 1_000_000;
const QTY_MAX = 10_000;

const newProduct = (ctx: Ctx, over: object = {}) =>
  call(ctx, {
    method: 'POST',
    url: '/products',
    payload: {
      sku: `T49-${Math.random().toString(36).slice(2, 8)}`,
      name: 'T49',
      price_cents: 100,
      stock: 1,
      ...over,
    },
  });
const revenueNew = async (ctx: Ctx) =>
  (await call(ctx, { url: '/stats', as: 'viewer' })).json<{ revenue_by_status: { new: number } }>()
    .revenue_by_status.new;

describe('Q-stats-overflow', () => {
  it('max price times max qty gives 200 with the exact sum', async () => {
    const ctx = await freshApp();
    const before = await revenueNew(ctx);
    const p = await newProduct(ctx, { price_cents: PRICE_MAX, stock: STOCK_MAX });
    expect(p.statusCode, p.body).toBe(201);
    const o = await call(ctx, {
      method: 'POST',
      url: '/orders',
      payload: { product_id: p.json<{ id: number }>().id, qty: QTY_MAX },
    });
    expect(o.statusCode, o.body).toBe(201);
    const res = await call(ctx, { url: '/stats', as: 'viewer' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await revenueNew(ctx)).toBe(before + PRICE_MAX * QTY_MAX);
  });

  it.each([
    ['price_cents 2_147_483_648', { price_cents: 2_147_483_648 }],
    ['price_cents over the limit', { price_cents: PRICE_MAX + 1 }],
    ['stock over the limit', { stock: STOCK_MAX + 1 }],
  ])('%s is 400 invalid_body on create and on patch, never 500', async (_n, bad) => {
    const ctx = await freshApp();
    const created = await newProduct(ctx, bad);
    expect(created.statusCode, created.body).toBe(400);
    expect(created.json()).toEqual({ error: 'invalid_body' });
    const ok = await newProduct(ctx);
    const patched = await call(ctx, {
      method: 'PATCH',
      url: `/products/${ok.json<{ id: number }>().id}`,
      payload: bad,
    });
    expect(patched.statusCode, patched.body).toBe(400);
    expect(patched.json()).toEqual({ error: 'invalid_body' });
  });

  it('order qty: 10_000 is accepted, 10_001 is 400 invalid_body', async () => {
    const ctx = await freshApp();
    const post = (qty: number) =>
      call(ctx, { method: 'POST', url: '/orders', payload: { product_id: 1, qty } });
    expect((await post(QTY_MAX)).statusCode).toBe(201);
    const over = await post(QTY_MAX + 1);
    expect(over.statusCode).toBe(400);
    expect(over.json()).toEqual({ error: 'invalid_body' });
  });
});

describe('Q-update-race', () => {
  // Runs `race(sql)` just before or just after the real statement that matches `when`.
  const intercept = (
    ctx: Ctx,
    when: RegExp,
    race: () => Promise<unknown>,
    at: 'before' | 'after',
  ) => {
    const real = ctx.app.db.query.bind(ctx.app.db);
    vi.spyOn(ctx.app.db, 'query').mockImplementation((async (sql: string, params?: unknown[]) => {
      if (!when.test(sql)) return real(sql, params);
      if (at === 'before') await race();
      const rows = await real(sql, params);
      if (at === 'after') await race();
      return rows;
    }) as never);
    return real;
  };

  it.each(['before', 'after'] as const)(
    'product deleted %s the update statement: 404 or the updated row, never 500',
    async (at) => {
      const ctx = await freshApp();
      const id = (await newProduct(ctx)).json<{ id: number }>().id;
      const real = intercept(
        ctx,
        /^\s*update products/i,
        () => real('delete from products where id = $1', [id]),
        at,
      );
      const res = await call(ctx, {
        method: 'PATCH',
        url: `/products/${id}`,
        payload: { stock: 5 },
      });
      expect(res.statusCode, res.body).toBe(at === 'before' ? 404 : res.statusCode);
      expect([200, 404]).toContain(res.statusCode);
      if (res.statusCode === 200) expect(res.json()).toMatchObject({ id, stock: 5 }); // not an empty body
    },
  );

  it.each(['before', 'after'] as const)(
    'order deleted %s the update statement: 404 or the updated row, never 500',
    async (at) => {
      const ctx = await freshApp();
      const id = (
        await call(ctx, { method: 'POST', url: '/orders', payload: { product_id: 1, qty: 1 } })
      ).json<{ id: number }>().id;
      const real = intercept(
        ctx,
        /^\s*update orders/i,
        () => real('delete from orders where id = $1', [id]),
        at,
      );
      const res = await call(ctx, {
        method: 'PATCH',
        url: `/orders/${id}`,
        payload: { status: 'paid' },
      });
      expect([200, 404], res.body).toContain(res.statusCode);
      if (res.statusCode === 200) expect(res.json()).toMatchObject({ id, status: 'paid' });
      if (at === 'before') expect(res.statusCode).toBe(404);
    },
  );
});

describe('Q-pool-error', () => {
  it('an error emitted on the pg pool is handled: no throw, the db stays usable', async () => {
    class FakePool extends EventEmitter {
      query = vi.fn(async () => ({ rows: [{ one: 1 }] }));
      end = vi.fn(async () => {});
    }
    let pool!: FakePool;
    vi.spyOn(pg, 'Pool').mockImplementation(function () {
      pool = new FakePool();
      return pool as never;
    } as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = await openDb('postgres://u:p@127.0.0.1:1/db');
    // An EventEmitter with no 'error' listener throws here; a handler must absorb it.
    expect(() => pool.emit('error', new Error('connection terminated unexpectedly'))).not.toThrow();
    expect(await db.query('select 1 as one')).toEqual([{ one: 1 }]);
  });
});

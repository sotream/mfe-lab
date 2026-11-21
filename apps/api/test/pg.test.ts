import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, freshApp, setup, type Ctx } from './helpers.ts';

// Postgres-specific behavior (T29): JSON shapes, case-insensitive search, 409 mapping.
const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let ctx: Ctx; // read-only shared app; mutating tests use freshApp()
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => ctx.app.close());

const get = async <T>(url: string, query?: Record<string, string>) => {
  const res = await call(ctx, { url, query, as: 'viewer' });
  expect(res.statusCode, `${url} ${res.body}`).toBe(200);
  return res.json<T>();
};

type Product = { id: number; price_cents: number; stock: number; created_at: string };
type Order = { id: number; product_id: number; qty: number; created_at: string };

describe('postgres shapes', () => {
  it('Q-pg-shapes: numbers are numbers, timestamps are ISO with ms and Z, flags boolean', async () => {
    const products = await get<{ items: Product[]; total: number; page: number; limit: number }>(
      '/products',
      { limit: '100' },
    );
    for (const k of ['total', 'page', 'limit'] as const) expect(typeof products[k]).toBe('number');
    expect(products.items).toHaveLength(30);
    const one = await get<Product>('/products/1');
    for (const p of [...products.items, one]) {
      for (const k of ['id', 'price_cents', 'stock'] as const) {
        expect(typeof p[k], `product ${p.id} ${k}`).toBe('number');
      }
      expect(p.created_at).toMatch(iso);
    }

    const orders = await get<{ items: Order[]; total: number }>('/orders', { limit: '100' });
    expect(typeof orders.total).toBe('number');
    expect(orders.items).toHaveLength(60);
    for (const o of orders.items) {
      for (const k of ['id', 'product_id', 'qty'] as const) {
        expect(typeof o[k], `order ${o.id} ${k}`).toBe('number');
      }
      expect(o.created_at).toMatch(iso);
    }

    const stats = await get<{
      counts: Record<string, number>;
      revenue_by_status: Record<string, number>;
      orders_per_day: { date: string; count: number }[];
    }>('/stats');
    for (const n of [...Object.values(stats.counts), ...Object.values(stats.revenue_by_status)]) {
      expect(typeof n).toBe('number');
    }
    expect(stats.orders_per_day.length).toBeGreaterThan(0);
    for (const d of stats.orders_per_day) {
      expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof d.count).toBe('number');
    }

    const flags = await get<{ enabled: unknown }[]>('/flags');
    expect(flags).toHaveLength(3);
    for (const f of flags) expect(typeof f.enabled).toBe('boolean');
  });

  it('Q-pg-shapes: created rows and updated rows keep the shapes', async () => {
    const c = await freshApp();
    const p = await call(c, {
      method: 'POST',
      url: '/products',
      as: 'editor',
      payload: { sku: 'PG-1', name: 'Shape', price_cents: 5, stock: 2 },
    });
    expect(p.statusCode, p.body).toBe(201);
    expect(typeof p.json<Product>().id).toBe('number');
    expect(p.json<Product>().created_at).toMatch(iso);
    const o = await call(c, { method: 'POST', url: '/orders', payload: { product_id: 1, qty: 1 } });
    expect(o.statusCode, o.body).toBe(201);
    expect(typeof o.json<Order>().id).toBe('number');
    expect(o.json<Order>().created_at).toMatch(iso);
    const patched = await call(c, {
      method: 'PATCH',
      url: '/flags/products.crash',
      payload: { enabled: true },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json<{ enabled: unknown }>().enabled).toBe(true);
  });
});

describe('postgres search', () => {
  const search = async (q: string) =>
    await get<{ items: { name: string }[]; total: number }>('/products', { q, limit: '100' });

  it('Q-pg-search: non-ASCII search is case-insensitive (wägezelle finds Wägezelle)', async () => {
    const lower = await search('wägezelle');
    expect(lower.items.map((p) => p.name)).toContain('Wägezelle');
    expect(lower.total).toBe(lower.items.length);
    const upper = await search('WÄGEZELLE');
    expect(upper.items.map((p) => p.name)).toContain('Wägezelle');
  });

  it('Q-pg-search: % and _ are literal, a backslash does not break the query', async () => {
    const c = await freshApp();
    const make = (sku: string, name: string) =>
      call(c, {
        method: 'POST',
        url: '/products',
        as: 'editor',
        payload: { sku, name, price_cents: 1, stock: 1 },
      });
    for (const [sku, name] of [
      ['LIT-1', '100% Baumwolle'],
      ['LIT-2', 'a_b Stück'],
      ['LIT-3', 'axb Stück'],
      ['LIT-4', 'Pfad C:\\temp'],
    ] as const) {
      expect((await make(sku, name)).statusCode).toBe(201);
    }
    const names = async (q: string) => {
      const res = await call(c, { url: '/products', query: { q, limit: '100' } });
      expect(res.statusCode, `${q} ${res.body}`).toBe(200);
      return res.json<{ items: { name: string }[] }>().items.map((p) => p.name);
    };
    expect(await names('%')).toEqual(['100% Baumwolle']);
    expect(await names('a_b')).toEqual(['a_b Stück']);
    expect(await names('\\')).toEqual(['Pfad C:\\temp']);
    expect(await names('_')).toEqual(['a_b Stück']);
  });
});

describe('postgres conflicts', () => {
  const clean = (body: string) =>
    !/postgres|\bpg\b|pglite|\bselect\b|\binsert\b|\bdelete\b|constraint|violates|23505|23503/i.test(
      body,
    );

  it('Q-pg-conflict: duplicate SKU gives 409 without DB detail', async () => {
    const c = await freshApp();
    const sku = (await call(c, { url: '/products/1' })).json<{ sku: string }>().sku;
    const dup = await call(c, {
      method: 'POST',
      url: '/products',
      as: 'editor',
      payload: { sku, name: 'dup', price_cents: 1, stock: 1 },
    });
    expect(dup.statusCode, dup.body).toBe(409);
    expect(dup.json()).toEqual({ error: 'conflict' });
    expect(clean(dup.body)).toBe(true);
    // the failed insert left the app working
    expect((await call(c, { url: '/products' })).statusCode).toBe(200);
  });

  it('Q-pg-conflict: deleting a product that has orders gives 409 without DB detail', async () => {
    const c = await freshApp();
    const [{ product_id: used }] = (await c.app.db.query<{ product_id: number }>(
      'SELECT product_id FROM orders LIMIT 1',
    )) as [{ product_id: number }];
    const res = await call(c, { method: 'DELETE', url: `/products/${used}`, as: 'editor' });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toEqual({ error: 'conflict' });
    expect(clean(res.body)).toBe(true);
    expect((await call(c, { url: `/products/${used}` })).statusCode).toBe(200);
  });
});

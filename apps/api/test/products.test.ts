import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, freshApp, isIso, isoCol, keysOf, productKeys, setup, type Ctx } from './helpers.ts';

type Product = {
  id: number;
  sku: string;
  name: string;
  price_cents: number;
  stock: number;
  created_at: string;
};
type Page = { items: Product[]; total: number; page: number; limit: number };

const sortFields = ['id', 'sku', 'name', 'price_cents', 'stock', 'created_at'] as const;
const valid = { sku: 'NEW-0001', name: 'New thing', price_cents: 1234, stock: 5 };

let ctx: Ctx; // read-only shared app; mutating tests use freshApp()
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => ctx.app.close());

const list = async (query: Record<string, string> = {}) => {
  const res = await call(ctx, { url: '/products', query });
  expect(res.statusCode, `${JSON.stringify(query)} ${res.body}`).toBe(200);
  return res.json<Page>();
};
const allRows = () =>
  ctx.app.db.query<Product>(
    `SELECT id, sku, name, price_cents, stock, ${isoCol()} FROM products ORDER BY products.id`,
  );
const literalMatch = async (q: string) =>
  (await allRows())
    .filter((p) => `${p.name}\n${p.sku}`.toLowerCase().includes(q.toLowerCase()))
    .map((p) => p.id);
const expectError = (
  res: { statusCode: number; json: () => unknown },
  status: number,
  error: string,
) => {
  expect(res.statusCode).toBe(status);
  expect(res.json()).toEqual({ error });
};

describe('products: read', () => {
  it('Q-list-default: 20 items of 30, page 1, ids ascending', async () => {
    const body = await list();
    expect(body).toMatchObject({ total: 30, page: 1, limit: 20 });
    expect(body.items).toHaveLength(20);
    const ids = body.items.map((p) => p.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('Q-pagination: last partial page, page past the end, limit 100', async () => {
    const second = await list({ page: '2', limit: '20' });
    expect(second.items).toHaveLength(10);
    expect(second).toMatchObject({ total: 30, page: 2, limit: 20 });
    const past = await list({ page: '4', limit: '10' });
    expect(past.items).toEqual([]);
    expect(past.total).toBe(30);
    expect((await list({ limit: '100' })).items).toHaveLength(30);
  });

  it('Q-sort: every field asc and desc matches SQL order', async () => {
    for (const sort of sortFields) {
      for (const order of ['asc', 'desc'] as const) {
        const got = (await list({ sort, order, limit: '100' })).items.map((p) => p[sort]);
        const sel = sort === 'created_at' ? isoCol('created_at').replace(/ AS .*/, '') : sort;
        const want = (
          await ctx.app.db.query<{ v: unknown }>(
            `SELECT ${sel} AS v FROM products ORDER BY ${sort} ${order}`,
          )
        ).map((r) => r.v);
        expect(got, `${sort} ${order}`).toEqual(want);
      }
    }
  });

  it('Q-search: q matches sku and name substrings case-insensitively', async () => {
    const [first] = await allRows();
    if (!first) throw new Error('seed has no products');
    const bySku = await list({ q: first.sku.toLowerCase(), limit: '100' });
    expect(bySku.items.map((p) => p.id)).toContain(first.id);
    expect(bySku.total).toBe((await literalMatch(first.sku)).length);

    const sub = first.name.slice(1, 4).toUpperCase();
    const byName = await list({ q: sub, limit: '100' });
    expect(byName.items.map((p) => p.id).sort((a, b) => a - b)).toEqual(await literalMatch(sub));
    expect(byName.total).toBe((await literalMatch(sub)).length);
  });

  it('Q-q-special: %, quote and underscore are literal, never 500', async () => {
    const percent = await list({ q: '%', limit: '100' });
    expect(percent.total).toBe(0);
    expect(percent.items).toEqual([]);
    for (const q of ["'", '_']) {
      const body = await list({ q, limit: '100' });
      expect(
        body.items.map((p) => p.id).sort((a, b) => a - b),
        q,
      ).toEqual(await literalMatch(q));
      expect(body.total, q).toBe((await literalMatch(q)).length);
    }
  });

  it('Q-query-400: invalid query values give invalid_query', async () => {
    const bad: Record<string, string>[] = [
      { page: '0' },
      { limit: '101' },
      { limit: 'abc' },
      { sort: 'password_hash' },
      { order: 'up' },
    ];
    for (const query of bad) {
      const res = await call(ctx, { url: '/products', query });
      expect(res.statusCode, JSON.stringify(query)).toBe(400);
      expect(res.json(), JSON.stringify(query)).toEqual({ error: 'invalid_query' });
    }
  });

  it('Q-get-one: exact keys, 404 for unknown id, 400 for bad ids', async () => {
    const res = await call(ctx, { url: '/products/1' });
    expect(res.statusCode).toBe(200);
    expect(keysOf(res.json<Product>())).toEqual(productKeys);
    expect(res.json()).toEqual((await allRows()).find((p) => p.id === 1));
    expectError(await call(ctx, { url: '/products/9999' }), 404, 'not_found');
    for (const id of ['abc', '0']) {
      expectError(await call(ctx, { url: `/products/${id}` }), 400, 'invalid_params');
    }
  });
});

describe('products: write', () => {
  it('Q-create: 201 with exact keys, 409 on duplicate sku, 400 on invalid bodies', async () => {
    const c = await freshApp();
    const before = Date.now();
    const res = await call(c, {
      method: 'POST',
      url: '/products',
      as: 'editor',
      payload: { ...valid, extra: 'ignored' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const created = res.json<Product>();
    expect(keysOf(created)).toEqual(productKeys);
    expect(created).toMatchObject(valid);
    expect(isIso(created.created_at)).toBe(true);
    expect(Date.parse(created.created_at)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(created.created_at)).toBeLessThanOrEqual(Date.now() + 1000);
    expect((await call(c, { url: `/products/${created.id}` })).json()).toEqual(created);

    const dup = await call(c, { method: 'POST', url: '/products', as: 'editor', payload: valid });
    expectError(dup, 409, 'conflict');

    const invalid = [
      { sku: 'X-1', price_cents: 1, stock: 1 },
      { ...valid, sku: 'X-2', price_cents: -1 },
      { ...valid, sku: 'X-3', stock: 1.5 },
      { ...valid, sku: 'X'.repeat(33) },
    ];
    for (const payload of invalid) {
      const r = await call(c, { method: 'POST', url: '/products', as: 'editor', payload });
      expect(r.statusCode, JSON.stringify(payload)).toBe(400);
      expect(r.json(), JSON.stringify(payload)).toEqual({ error: 'invalid_body' });
    }
    const malformed = await call(c, {
      method: 'POST',
      url: '/products',
      as: 'editor',
      payload: '{"sku":',
      headers: { 'content-type': 'application/json' },
    });
    expectError(malformed, 400, 'invalid_body');
  });

  it('Q-update: patch name keeps id and created_at; {} 400, unknown 404, dup sku 409', async () => {
    const c = await freshApp();
    const original = (await call(c, { url: '/products/1' })).json<Product>();
    const res = await call(c, {
      method: 'PATCH',
      url: '/products/1',
      as: 'editor',
      payload: { name: 'Renamed' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ...original, name: 'Renamed' });

    const patch = (url: string, payload: object) =>
      call(c, { method: 'PATCH', url, as: 'editor', payload });
    expectError(await patch('/products/1', {}), 400, 'invalid_body');
    expectError(await patch('/products/9999', { name: 'x' }), 404, 'not_found');
    const other = (await call(c, { url: '/products/2' })).json<Product>();
    expectError(await patch('/products/1', { sku: other.sku }), 409, 'conflict');
  });

  it('Q-delete: 409 when orders reference it, 204 then 404 otherwise', async () => {
    const c = await freshApp();
    const [{ product_id: used }] = (await c.app.db.query<{ product_id: number }>(
      'SELECT product_id FROM orders LIMIT 1',
    )) as [{ product_id: number }];
    const del = (id: number) => call(c, { method: 'DELETE', url: `/products/${id}`, as: 'editor' });
    expectError(await del(used), 409, 'conflict');
    expect((await call(c, { url: `/products/${used}` })).statusCode).toBe(200);

    const created = await call(c, {
      method: 'POST',
      url: '/products',
      as: 'editor',
      payload: valid,
    });
    const { id } = created.json<Product>();
    const gone = await del(id);
    expect(gone.statusCode).toBe(204);
    expect(gone.body).toBe('');
    expectError(await call(c, { url: `/products/${id}` }), 404, 'not_found');
  });
});

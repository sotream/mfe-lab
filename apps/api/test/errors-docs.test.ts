import { describe, expect, it } from 'vitest';
import {
  call,
  freshApp,
  keysOf,
  orderKeys,
  productKeys,
  type Call,
  type Ctx,
  type Role,
} from './helpers.ts';

const statusOf = async (ctx: Ctx, req: Call) => (await call(ctx, req)).statusCode;

// Product writes for one role on its own product: POST, PATCH, DELETE.
const productWrites = async (ctx: Ctx, as: Role) => {
  const created = await call(ctx, {
    method: 'POST',
    url: '/products',
    as,
    payload: { sku: `ROLE-${as}`, name: 'Role test', price_cents: 1, stock: 1 },
  });
  const id = created.statusCode === 201 ? created.json<{ id: number }>().id : 1;
  return [
    created.statusCode,
    await statusOf(ctx, { method: 'PATCH', url: `/products/${id}`, as, payload: { stock: 2 } }),
    await statusOf(ctx, { method: 'DELETE', url: `/products/${id}`, as }),
  ];
};

const orderWrites = async (ctx: Ctx, as: Role) => [
  await statusOf(ctx, { method: 'POST', url: '/orders', as, payload: { product_id: 1, qty: 1 } }),
  await statusOf(ctx, { method: 'PATCH', url: '/orders/1', as, payload: { status: 'paid' } }),
];

const routes: Call[] = [
  { url: '/products' },
  { url: '/products/1' },
  { method: 'POST', url: '/products', payload: { sku: 'A', name: 'A', price_cents: 1, stock: 1 } },
  { method: 'PATCH', url: '/products/1', payload: { stock: 1 } },
  { method: 'DELETE', url: '/products/1' },
  { url: '/orders' },
  { method: 'POST', url: '/orders', payload: { product_id: 1, qty: 1 } },
  { method: 'PATCH', url: '/orders/1', payload: { status: 'paid' } },
  { url: '/stats' },
];

const leaks = (body: string) => /sqlite|postgres|pglite|\bselect\b| at /i.test(body);

describe('roles, errors and docs', () => {
  it('Q-roles: write matrix, 401 everywhere without token, 401 before 400', async () => {
    const ctx = await freshApp();
    expect(await productWrites(ctx, 'viewer')).toEqual([403, 403, 403]);
    expect(await productWrites(ctx, 'editor')).toEqual([201, 200, 204]);
    expect(await productWrites(ctx, 'admin')).toEqual([201, 200, 204]);
    expect(await orderWrites(ctx, 'editor')).toEqual([403, 403]);
    expect(await orderWrites(ctx, 'viewer')).toEqual([403, 403]);
    expect(await orderWrites(ctx, 'admin')).toEqual([201, 200]);

    const viewer = await call(ctx, { method: 'DELETE', url: '/products/1', as: 'viewer' });
    expect(viewer.json()).toEqual({ error: 'forbidden' });

    const anonymous: Call[] = [
      ...routes,
      { method: 'POST', url: '/products', payload: {} },
      { method: 'POST', url: '/orders', payload: { qty: 0 } },
      { url: '/products', query: { page: '0' } },
    ];
    for (const req of anonymous) {
      const res = await call(ctx, { ...req, as: null });
      const label = `${req.method ?? 'GET'} ${req.url} ${JSON.stringify(req.payload ?? req.query)}`;
      expect(res.statusCode, label).toBe(401);
      expect(res.json(), label).toEqual({ error: 'unauthorized' });
    }
  });

  it('Q-no-leak: exact keys on products and orders; no SQL or stack in error bodies', async () => {
    const ctx = await freshApp();
    const product = await call(ctx, { url: '/products/1' });
    expect(keysOf(product.json<object>())).toEqual(productKeys);
    for (const p of (await call(ctx, { url: '/products' })).json<{ items: object[] }>().items) {
      expect(keysOf(p)).toEqual(productKeys);
    }
    for (const o of (await call(ctx, { url: '/orders' })).json<{ items: object[] }>().items) {
      expect(keysOf(o)).toEqual(orderKeys);
    }
    const sku = product.json<{ sku: string }>().sku;
    const [{ product_id: used }] = (await ctx.app.db.query<{ product_id: number }>(
      'SELECT product_id FROM orders LIMIT 1',
    )) as [{ product_id: number }];
    const errors = [
      await call(ctx, { url: '/products/9999' }),
      await call(ctx, { url: '/products/abc' }),
      await call(ctx, { url: '/products', query: { sort: 'password_hash' } }),
      await call(ctx, {
        method: 'POST',
        url: '/products',
        payload: { sku, name: 'dup', price_cents: 1, stock: 1 },
      }),
      await call(ctx, { method: 'POST', url: '/orders', payload: { product_id: 99_999, qty: 1 } }),
      await call(ctx, { method: 'DELETE', url: `/products/${used}` }),
      await call(ctx, {
        method: 'POST',
        url: '/products',
        payload: '{"sku":',
        headers: { 'content-type': 'application/json' },
      }),
      await call(ctx, { url: '/no-such-route' }),
    ];
    for (const res of errors) {
      expect(res.statusCode, res.body).toBeGreaterThanOrEqual(400);
      expect(leaks(res.body), res.body).toBe(false);
    }
    expect(errors.at(-1)?.statusCode).toBe(404);
  });

  it('Q-docs: public OpenAPI 3 JSON with contract paths, /docs serves HTML', async () => {
    const ctx = await freshApp();
    const spec = await call(ctx, { url: '/docs/json', as: null });
    expect(spec.statusCode).toBe(200);
    const doc = spec.json<{ openapi: string; paths: Record<string, unknown> }>();
    expect(doc.openapi).toMatch(/^3/);
    for (const path of [
      '/products',
      '/products/{id}',
      '/orders',
      '/orders/{id}',
      '/stats',
      '/auth/login',
      '/auth/me',
    ]) {
      expect(Object.keys(doc.paths), path).toContain(path);
    }

    let res = await call(ctx, { url: '/docs', as: null });
    for (let hops = 0; res.statusCode >= 300 && res.statusCode < 400 && hops < 3; hops++) {
      const next = new URL(String(res.headers.location), 'http://localhost/docs');
      res = await call(ctx, { url: next.pathname + next.search, as: null });
    }
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/html');
  });
});

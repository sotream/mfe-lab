import { afterEach, describe, expect, it, vi } from 'vitest';
import { authed, seededApp, stubPreview, stubProd, tokenOf, type App } from './owner.ts';

afterEach(() => vi.unstubAllEnvs());

const newProduct = (sku: string) => ({ sku, name: 'Demo', price_cents: 100, stock: 1 });

// Every destructive call from the contract, as [label, call]. Product delete needs a product to exist.
const destructive = (app: App, token: string, productId: number) =>
  [
    [
      'registry patch',
      () => authed(app, token, 'PATCH', '/registry/products', { canaryPercent: 10 }),
    ],
    ['registry off', () => authed(app, token, 'PATCH', '/registry/products', { disabled: true })],
    ['flag write', () => authed(app, token, 'PATCH', '/flags/products.crash', { enabled: true })],
    ['errors delete', () => authed(app, token, 'DELETE', '/errors')],
    ['order create', () => authed(app, token, 'POST', '/orders', { product_id: 1, qty: 1 })],
    ['order update', () => authed(app, token, 'PATCH', '/orders/1', { status: 'paid' })],
    ['product delete', () => authed(app, token, 'DELETE', `/products/${productId}`)],
  ] as const;

const createProduct = async (app: App, token: string, sku: string) => {
  const res = await authed(app, token, 'POST', '/products', newProduct(sku));
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ id: number }>().id;
};

describe('demo admin lock', () => {
  it('Q-demo-lock: in production admin gets 403 demo_read_only on every destructive call', async () => {
    stubProd();
    const app = await seededApp();
    const token = await tokenOf(app, 'admin@lab.test');
    const id = await createProduct(app, token, 'LOCK-0001');
    for (const [label, run] of destructive(app, token, id)) {
      const res = await run();
      expect(res.statusCode, label).toBe(403);
      expect(res.json(), label).toEqual({ error: 'demo_read_only' });
    }
    // nothing changed
    expect(
      (await authed(app, token, 'PATCH', '/products/' + id, { name: 'Renamed' })).statusCode,
    ).toBe(200);
    const flags = (
      await app.inject({
        method: 'GET',
        url: '/flags',
        headers: { authorization: `Bearer ${token}` },
      })
    ).json<{ name: string; enabled: boolean }[]>();
    expect(flags.find((f) => f.name === 'products.crash')?.enabled).toBe(false);
  });

  it('Q-demo-lock: in production admin can still create and edit products, and read everything', async () => {
    stubProd();
    const app = await seededApp();
    const token = await tokenOf(app, 'admin@lab.test');
    const id = await createProduct(app, token, 'LOCK-0002');
    const patched = await authed(app, token, 'PATCH', `/products/${id}`, { stock: 7 });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json()).toMatchObject({ id, stock: 7 });
    for (const url of [
      '/products',
      '/orders',
      '/flags',
      '/errors',
      '/errors/summary',
      '/registry',
    ]) {
      const res = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode, url).toBe(200);
    }
  });

  it('Q-demo-lock: in production editor creates and edits products; its product delete gets demo_read_only and other writes the plain 403', async () => {
    stubProd();
    const app = await seededApp();
    const token = await tokenOf(app, 'editor@lab.test');
    const id = await createProduct(app, token, 'LOCK-0003');
    expect((await authed(app, token, 'PATCH', `/products/${id}`, { stock: 2 })).statusCode).toBe(
      200,
    );
    const res = await authed(app, token, 'PATCH', '/flags/products.crash', { enabled: true });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden' });
    const del = await authed(app, token, 'DELETE', `/products/${id}`);
    expect(del.statusCode).toBe(403);
    expect(del.json()).toEqual({ error: 'demo_read_only' });
  });

  it('Q-demo-lock: /auth/me flags a locked admin with demo: true, and an editor; a viewer has none', async () => {
    stubProd();
    const app = await seededApp();
    const demoOf = async (email: string) => {
      const token = await tokenOf(app, email);
      const body = (
        await app.inject({
          method: 'GET',
          url: '/auth/me',
          headers: { authorization: `Bearer ${token}` },
        })
      ).json<{ demo?: boolean; user: { demo?: boolean } }>();
      return body.demo ?? body.user.demo;
    };
    expect(await demoOf('admin@lab.test')).toBe(true);
    // real behaviour: the lock also covers editor, so it is demo too
    expect(await demoOf('editor@lab.test')).toBe(true);
    expect(await demoOf('viewer@lab.test')).toBeFalsy();
  });

  it.each([
    ['development/test (production flag off)', () => {}],
    ['a PR preview', stubPreview],
  ])('Q-demo-lock: %s leaves admin unlocked, and /auth/me has no demo flag', async (_n, setEnv) => {
    setEnv();
    const app = await seededApp();
    const token = await tokenOf(app, 'admin@lab.test');
    const id = await createProduct(app, token, 'LOCK-0004');
    for (const [label, run] of destructive(app, token, id)) {
      const res = await run();
      expect(res.statusCode, `${label}: ${res.body}`).toBeLessThan(300);
    }
    const me = (
      await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: `Bearer ${token}` },
      })
    ).json<{ demo?: boolean; user: { demo?: boolean } }>();
    expect(me.demo ?? me.user.demo).toBeFalsy();
  });
});

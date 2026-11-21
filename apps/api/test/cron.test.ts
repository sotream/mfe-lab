import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { seed } from '../src/seed.ts';
import { counts } from './helpers.ts';

const SECRET = 'cron-test-secret';
afterEach(() => vi.unstubAllEnvs());

const appWith = async (secret?: string) => {
  vi.stubEnv('CRON_SECRET', secret); // undefined removes it
  const app = await buildApp({ dbUrl: 'pglite:memory', jwtSecret: 'test-secret' });
  await seed(app.db);
  return app;
};
const get = (app: Awaited<ReturnType<typeof appWith>>, authorization?: string) =>
  app.inject({
    method: 'GET',
    url: '/cron/reseed',
    headers: authorization ? { authorization } : {},
  });

describe('cron reseed', () => {
  it('Q-cron: CRON_SECRET unset gives 404, even with a bearer header', async () => {
    const app = await appWith();
    expect((await get(app)).statusCode).toBe(404);
    expect((await get(app, `Bearer ${SECRET}`)).statusCode).toBe(404);
    await app.close();
  });

  it('Q-cron: no header or a wrong token gives 401 and leaves data alone', async () => {
    const app = await appWith(SECRET);
    for (const h of [undefined, 'Bearer nope', SECRET, 'Basic abc']) {
      expect((await get(app, h)).statusCode, String(h)).toBe(401);
    }
    expect(await counts(app.db)).toEqual({ users: 3, products: 30, orders: 60 });
    await app.close();
  });

  it('Q-cron: the right token reseeds to 3/30/60 and drops data created before', async () => {
    const app = await appWith(SECRET);
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@lab.test', password: 'lab12345' }, // demo-only seed password
    });
    const created = await app.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${login.json<{ token: string }>().token}` },
      payload: { sku: 'CRON-0001', name: 'Temp', price_cents: 100, stock: 1 },
    });
    expect(created.statusCode).toBe(201);
    expect((await counts(app.db)).products).toBe(31);

    const res = await get(app, `Bearer ${SECRET}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reseeded: true, users: 3, products: 30, orders: 60 });
    expect(await counts(app.db)).toEqual({ users: 3, products: 30, orders: 60 });
    expect(await app.db.query("SELECT 1 FROM products WHERE sku = 'CRON-0001'")).toEqual([]);

    const docs = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(Object.keys(docs.json<{ paths: object }>().paths)).not.toContain('/cron/reseed');
    await app.close();
  });
});

// Q-canary-allowlist, Q-headers (API), Q-errors-bounds. Black box from the T46 contract.
// ASSUMPTIONS: production = NODE_ENV==='production' (read at request time or app build, both work here
// because the stub stays active for the whole test); 400 body error code is `invalid_canary_url`;
// over-long /errors values give 400; the oversized body gives 413 or 400.
import { onTestFinished, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { migrate } from '../src/db.ts';
import { seed } from '../src/seed.ts';
import { call, freshApp, type Ctx } from './helpers.ts';

const prodCtx = async (): Promise<Ctx> => {
  vi.stubEnv('NODE_ENV', 'production');
  onTestFinished(() => void vi.unstubAllEnvs());
  const app = await buildApp({
    dbUrl: 'pglite:memory',
    jwtSecret: 'canary-allowlist-test-secret-0123456789abcdef',
    migrate: true,
  });
  onTestFinished(() => app.close());
  await seed(app.db);
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'admin@lab.test', password: 'lab12345' }, // demo-only seed password
  });
  return { app, tokens: { admin: res.json<{ token: string }>().token } as Ctx['tokens'] };
};
const patch = (ctx: Ctx, canaryUrl: string | null) =>
  call(ctx, { method: 'PATCH', url: '/registry/products', payload: { canaryUrl } });

const GOOD = [
  'https://mfe-lab-products.vercel.app/mf-manifest.json',
  'https://mfe-lab-products.vercel.app/releases/1.0.0/mf-manifest.json',
  'https://mfe-lab-products-pr-12.vercel.app/mf-manifest.json',
];
const BAD = [
  'https://evil.example/mf-manifest.json',
  'https://mfe-lab.vercel.app@evil.example/mf-manifest.json',
  'https://user:pw@mfe-lab-products.vercel.app/mf-manifest.json',
  'http://mfe-lab-products.vercel.app/mf-manifest.json',
  'https://mfe-lab-products.vercel.app/evil.js',
  'https://mfe-lab-products.vercel.app/mf-manifest.json.js',
  'https://mfe-lab-products-pr-12.vercel.app.evil.example/mf-manifest.json',
  'https://evil-mfe-lab-products-pr-1.vercel.app/mf-manifest.json',
  'https://mfe-lab-products-pr-.vercel.app/mf-manifest.json',
  'https://mfe-lab-products-pr-1x.vercel.app/mf-manifest.json',
  'https://mfe-lab-api-pr-1.vercel.app/mf-manifest.json',
  'http://localhost:3001/mf-manifest.json', // only outside production
];

describe('canary allowlist', () => {
  it('Q-canary-allowlist: production rejects bad URLs with 400 invalid_canary_url', async () => {
    const ctx = await prodCtx();
    for (const u of BAD) {
      const res = await patch(ctx, u);
      expect(res.statusCode, u).toBe(400);
      expect(res.json<{ error: string }>().error, u).toBe('invalid_canary_url');
    }
    expect(
      (await call(ctx, { url: '/registry', as: null })).json<{ canaryUrl: unknown }[]>(),
    ).toSatisfy((rows: { canaryUrl: unknown }[]) => rows.every((r) => r.canaryUrl === null));
  });

  it('Q-canary-allowlist: production accepts production and PR preview hosts, and null', async () => {
    const ctx = await prodCtx();
    for (const u of [...GOOD, null]) expect((await patch(ctx, u)).statusCode, String(u)).toBe(200);
  });

  it('Q-canary-allowlist: outside production the same bad URLs are rejected, localhost is allowed', async () => {
    const ctx = await freshApp();
    for (const u of BAD.filter((x) => !x.startsWith('http://localhost')))
      expect((await patch(ctx, u)).statusCode, u).toBe(400);
    for (const u of [...GOOD, 'http://localhost:3001/mf-manifest.json'])
      expect((await patch(ctx, u)).statusCode, u).toBe(200);
  });

  it('Q-canary-allowlist: migrate (the deploy step) nulls and zeroes a row whose canary fails the check', async () => {
    const ctx = await prodCtx();
    await ctx.app.db.query(
      `update remotes set canary_url = 'https://evil.example/mf-manifest.json', canary_percent = 100 where name = 'products'`,
    );
    await ctx.app.db.query(
      `update remotes set canary_url = 'https://mfe-lab-orders.vercel.app/mf-manifest.json' where name = 'orders'`,
    );
    await migrate(ctx.app.db); // the sweep runs in migrate()
    const rows = (await call(ctx, { url: '/registry', as: null })).json<
      { name: string; canaryUrl: string | null; canaryPercent: number }[]
    >();
    expect(rows.find((r) => r.name === 'products')).toMatchObject({
      canaryUrl: null,
      canaryPercent: 0,
    });
    expect(rows.find((r) => r.name === 'orders')?.canaryUrl).toBe(
      'https://mfe-lab-orders.vercel.app/mf-manifest.json',
    );
  });
});

describe('api headers', () => {
  it('Q-headers: every response has nosniff; authenticated JSON is no-store', async () => {
    const ctx = await freshApp();
    for (const r of [
      await call(ctx, { url: '/registry', as: null }),
      await call(ctx, { url: '/products' }),
      await call(ctx, { url: '/products', as: null }), // 401
      await call(ctx, { url: '/nope', as: null }), // 404
    ])
      expect(r.headers['x-content-type-options'], r.body).toBe('nosniff');
    const authed = await call(ctx, { url: '/products' });
    expect(authed.statusCode).toBe(200);
    expect(authed.headers['cache-control']).toMatch(/no-store/);
  });

  it('Q-headers: an unknown route returns 404 { error: not_found }', async () => {
    const ctx = await freshApp();
    for (const method of ['GET', 'POST'] as const) {
      const res = await call(ctx, { method, url: '/definitely/not/here', as: null });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not_found' });
    }
  });
});

describe('errors bounds', () => {
  const ok = {
    remote: 'products',
    build: 'b1',
    kind: 'render',
    message: 'boom',
    url: 'http://localhost:3000/',
  };
  const post = (ctx: Ctx, payload: object | string) =>
    call(ctx, { method: 'POST', url: '/errors', as: null, payload });

  it('Q-errors-bounds: a normal report (with stack) still gives 201', async () => {
    const ctx = await freshApp();
    expect((await post(ctx, { ...ok, stack: 'Error: boom\n  at x' })).statusCode).toBe(201);
    expect(
      (await post(ctx, { ...ok, url: 'https://mfe-lab.vercel.app/products' })).statusCode,
    ).toBe(201);
  });

  it('Q-errors-bounds: a 900 KB body is rejected with 413 or 400', async () => {
    const ctx = await freshApp();
    const res = await post(ctx, { ...ok, message: 'x'.repeat(900 * 1024) });
    expect([400, 413]).toContain(res.statusCode);
  });

  it('Q-errors-bounds: over-long values and non-http(s) urls give 400; limits are inclusive', async () => {
    const ctx = await freshApp();
    for (const bad of [
      { message: 'x'.repeat(2001) },
      { stack: 'x'.repeat(8001) },
      { url: 'http://localhost/' + 'x'.repeat(2000) },
      { url: 'javascript:alert(1)' },
      { url: 'data:text/html,<script>1</script>' },
      { url: 'ftp://example.com/' },
      { remote: 'x'.repeat(201) },
      { build: 'x'.repeat(201) },
    ])
      expect(
        (await post(ctx, { ...ok, ...bad })).statusCode,
        JSON.stringify(bad).slice(0, 60),
      ).toBe(400);
    for (const good of [{ message: 'x'.repeat(2000) }, { stack: 'x'.repeat(8000) }])
      expect((await post(ctx, { ...ok, ...good })).statusCode).toBe(201);
  });
});

import { describe, expect, it } from 'vitest';
import { call, freshApp } from './helpers.ts';

// T65: anonymous registry reads are CDN-cacheable for a few seconds; authorized reads stay fresh.
describe('GET /registry cache headers', () => {
  it('Q-registry-cache: anonymous gets a short public CDN cache, not no-store', async () => {
    const ctx = await freshApp();
    const res = await call(ctx, { url: '/registry', as: null });
    expect(res.statusCode, res.body).toBe(200);
    const cc = String(res.headers['cache-control']);
    expect(cc).toContain('public');
    expect(cc).toContain('s-maxage=5');
    expect(cc).toContain('stale-while-revalidate=60');
    expect(cc).not.toMatch(/no-store/);
  });

  it('Q-registry-cache: a request with a bearer token stays no-store', async () => {
    const ctx = await freshApp();
    const res = await call(ctx, { url: '/registry', as: 'admin' });
    expect(res.statusCode, res.body).toBe(200);
    expect(String(res.headers['cache-control'])).toMatch(/no-store/);
    expect(String(res.headers['cache-control'])).not.toContain('public');
  });

  it('Q-registry-cache: the body is the same with and without auth', async () => {
    const ctx = await freshApp();
    const anon = await call(ctx, { url: '/registry', as: null });
    const authed = await call(ctx, { url: '/registry', as: 'admin' });
    expect(anon.json()).toEqual(authed.json());
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getProduct } from '../src/index.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('getProduct', () => {
  it('Q-get-product: GET /products/3 and parsed result', async () => {
    const p = { id: 3, sku: 'S', name: 'N', price_cents: 1, stock: 2, created_at: '2026-10-01' };
    const fetch = vi.fn(() => Promise.resolve(json(200, p)));
    vi.stubGlobal('fetch', fetch);
    expect(await getProduct(3)).toEqual(p);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(new URL(url, 'http://x').pathname.endsWith('/products/3')).toBe(true);
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('Q-get-product: 404 throws ApiError with status 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json(404, { error: 'not_found' }))),
    );
    const err = await getProduct(3).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404 });
  });
});

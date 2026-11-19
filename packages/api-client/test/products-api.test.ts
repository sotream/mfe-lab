import { login, logout } from '@mfe/auth-store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProduct, deleteProduct, listProducts, updateProduct } from '../src/index.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const product = {
  id: 5,
  sku: 'SKU-0005',
  name: 'Five',
  price_cents: 500,
  stock: 5,
  created_at: '2026-10-01T00:00:00.000Z',
};
const stubFetch = (res: () => Response) => {
  const fetch = vi.fn(() => Promise.resolve(res()));
  vi.stubGlobal('fetch', fetch);
  return fetch;
};
const lastCall = (fetch: ReturnType<typeof stubFetch>) => {
  const [url, init] = fetch.mock.calls.at(-1) as unknown as [string, RequestInit | undefined];
  const parsed = new URL(url, 'http://x');
  return {
    path: parsed.pathname,
    params: Object.fromEntries(parsed.searchParams),
    method: init?.method ?? 'GET',
    body: init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown),
    auth: new Headers(init?.headers).get('authorization'),
  };
};

afterEach(() => {
  logout();
  vi.unstubAllGlobals();
});

describe('api-client products', () => {
  it('Q-api-products: method, URL, body and parsed result per endpoint', async () => {
    const page = { items: [product], total: 1, page: 2, limit: 10 };
    let fetch = stubFetch(() => json(200, page));
    await expect(
      listProducts({ page: 2, limit: 10, sort: 'name', order: 'desc', q: 'a b' }),
    ).resolves.toEqual(page);
    expect(lastCall(fetch)).toMatchObject({
      path: '/api/products',
      method: 'GET',
      params: { page: '2', limit: '10', sort: 'name', order: 'desc', q: 'a b' },
      body: undefined,
    });

    const input = { sku: 'SKU-0005', name: 'Five', price_cents: 500, stock: 5 };
    fetch = stubFetch(() => json(201, product));
    await expect(createProduct(input)).resolves.toEqual(product);
    expect(lastCall(fetch)).toMatchObject({ path: '/api/products', method: 'POST', body: input });

    fetch = stubFetch(() => json(200, { ...product, name: 'New' }));
    await expect(updateProduct(5, { name: 'New' })).resolves.toEqual({ ...product, name: 'New' });
    expect(lastCall(fetch)).toMatchObject({
      path: '/api/products/5',
      method: 'PATCH',
      body: { name: 'New' },
    });

    fetch = stubFetch(() => new Response(null, { status: 204 }));
    await expect(deleteProduct(5)).resolves.toBeUndefined();
    expect(lastCall(fetch)).toMatchObject({ path: '/api/products/5', method: 'DELETE' });
  });

  it('Q-api-products-auth: sends the bearer token through request()', async () => {
    stubFetch(() =>
      json(200, { token: 't1', user: { id: 1, email: 'admin@lab.test', role: 'admin' } }),
    );
    await login('admin@lab.test', 'lab12345');
    const fetch = stubFetch(() => json(200, { items: [], total: 0, page: 1, limit: 10 }));
    await listProducts({});
    expect(lastCall(fetch).auth).toBe('Bearer t1');
  });
});

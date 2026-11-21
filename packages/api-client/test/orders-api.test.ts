// Q-api-orders: listOrders(query) -> GET /api/orders with the real API's query params (page, limit, status).
import { login, logout } from '@mfe/auth-store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listOrders } from '../src/index.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const page = {
  items: [{ id: 7, product_id: 3, qty: 2, status: 'paid', created_at: '2026-10-05T09:30:00.000Z' }],
  total: 1,
  page: 1,
  limit: 10,
};

afterEach(() => {
  logout();
  vi.unstubAllGlobals();
});

describe('api-client orders', () => {
  const signIn = async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          json(200, { token: 't1', user: { id: 3, email: 'viewer@lab.test', role: 'viewer' } }),
        ),
      ),
    );
    await login('viewer@lab.test', 'lab12345');
  };
  const call = (fetch: ReturnType<typeof vi.fn>) =>
    fetch.mock.calls[0] as unknown as [string, RequestInit | undefined];

  it('Q-api-orders: GET /api/orders with the status filter and paging, bearer attached', async () => {
    await signIn();
    const fetch = vi.fn(() => Promise.resolve(json(200, page)));
    vi.stubGlobal('fetch', fetch);

    await expect(listOrders({ page: 2, limit: 5, status: 'paid' })).resolves.toEqual(page);
    const [url, init] = call(fetch);
    const u = new URL(url, 'http://x');
    expect(u.pathname).toBe('/api/orders');
    expect(Object.fromEntries(u.searchParams)).toEqual({ page: '2', limit: '5', status: 'paid' });
    expect(init?.method ?? 'GET').toBe('GET');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer t1');
  });

  it('Q-api-orders: no status means no status param', async () => {
    await signIn();
    const fetch = vi.fn(() => Promise.resolve(json(200, page)));
    vi.stubGlobal('fetch', fetch);
    await listOrders({});
    expect(new URL(call(fetch)[0], 'http://x').searchParams.has('status')).toBe(false);
  });

  it('Q-api-orders: a 401 logs out and rejects', async () => {
    await signIn();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json(401, { error: 'unauthorized' }))),
    );
    await expect(listOrders({})).rejects.toMatchObject({ status: 401 });
  });
});

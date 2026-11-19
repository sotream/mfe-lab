import { login, logout } from '@mfe/auth-store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStats } from '../src/index.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const stats = {
  counts: { products: 30, orders: 60 },
  revenue_by_status: { new: 1, paid: 2, shipped: 3 },
  orders_per_day: [{ date: '2026-10-01', count: 60 }],
};

afterEach(() => {
  logout();
  vi.unstubAllGlobals();
});

describe('api-client stats', () => {
  it('Q-api-stats: GET /api/stats with bearer, resolves the body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          json(200, { token: 't1', user: { id: 3, email: 'viewer@lab.test', role: 'viewer' } }),
        ),
      ),
    );
    await login('viewer@lab.test', 'lab12345');
    const fetch = vi.fn(() => Promise.resolve(json(200, stats)));
    vi.stubGlobal('fetch', fetch);

    await expect(getStats()).resolves.toEqual(stats);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(url).toBe('/api/stats');
    expect(init?.method ?? 'GET').toBe('GET');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer t1');
  });
});

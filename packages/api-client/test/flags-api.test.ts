import { login, logout } from '@mfe/auth-store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listFlags, setFlag } from '../src/index.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const flag = { name: 'dashboard.revenue', enabled: false, description: 'd' };

const signIn = async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        json(200, { token: 't1', user: { id: 1, email: 'admin@lab.test', role: 'admin' } }),
      ),
    ),
  );
  await login('admin@lab.test', 'lab12345');
};

afterEach(() => {
  logout();
  vi.unstubAllGlobals();
});

describe('api-client flags', () => {
  it('Q-flags-client: listFlags GETs /api/flags with bearer', async () => {
    await signIn();
    const fetch = vi.fn(() => Promise.resolve(json(200, [flag])));
    vi.stubGlobal('fetch', fetch);
    await expect(listFlags()).resolves.toEqual([flag]);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(url).toBe('/api/flags');
    expect(init?.method ?? 'GET').toBe('GET');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer t1');
  });

  it('Q-flags-client: setFlag PATCHes the encoded name with {enabled}', async () => {
    await signIn();
    const fetch = vi.fn(() => Promise.resolve(json(200, { ...flag, enabled: true })));
    vi.stubGlobal('fetch', fetch);
    await expect(setFlag('a b/c', true)).resolves.toEqual({ ...flag, enabled: true });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/flags/${encodeURIComponent('a b/c')}`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ enabled: true });
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer t1');
  });
});

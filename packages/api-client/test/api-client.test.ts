import { getToken, login, logout } from '@mfe/auth-store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, request } from '../src/index.ts';

const admin = { id: 1, email: 'admin@lab.test', role: 'admin' } as const;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const stubFetch = (impl: () => Promise<Response> = () => Promise.resolve(json(200, {}))) => {
  const fetch = vi.fn(impl);
  vi.stubGlobal('fetch', fetch);
  return fetch;
};
const lastCall = (fetch: ReturnType<typeof stubFetch>) =>
  fetch.mock.calls.at(-1) as unknown as [string, RequestInit | undefined];
const headerOf = (init: RequestInit | undefined, name: string) =>
  new Headers(init?.headers).get(name);
const signIn = async () => {
  stubFetch(() => Promise.resolve(json(200, { token: 't1', user: admin })));
  await login(admin.email, 'lab12345');
  expect(getToken()).toBe('t1');
};
const rejection = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e,
  );

afterEach(() => {
  logout();
  vi.unstubAllGlobals();
});

describe('api-client', () => {
  it('Q-client-url: /api prefix, URLSearchParams query, undefined skipped, no bare ?', async () => {
    const fetch = stubFetch();
    await request('/products', { query: { page: 2, q: 'a b', sort: undefined } });
    expect(lastCall(fetch)[0]).toBe('/api/products?page=2&q=a+b');
    await request('/products');
    expect(lastCall(fetch)[0]).toBe('/api/products');
    await request('/products', { query: { sort: undefined } });
    expect(lastCall(fetch)[0]).toBe('/api/products');
  });

  it('Q-client-headers: bearer only when signed in, json only with a body', async () => {
    let fetch = stubFetch();
    await request('/stats');
    let init = lastCall(fetch)[1];
    expect(headerOf(init, 'authorization')).toBeNull();
    expect(headerOf(init, 'content-type')).toBeNull();
    expect(init?.method ?? 'GET').toBe('GET');
    expect(init?.body ?? undefined).toBeUndefined();

    await signIn();
    fetch = stubFetch();
    const body = { sku: 'X-1', name: 'x', price_cents: 1, stock: 1 };
    await request('/products', { method: 'POST', body });
    init = lastCall(fetch)[1];
    expect(headerOf(init, 'authorization')).toBe('Bearer t1');
    expect(init?.method).toBe('POST');
    expect(headerOf(init, 'content-type')).toBe('application/json');
    expect(init?.body).toBe(JSON.stringify(body));

    await request('/stats');
    init = lastCall(fetch)[1];
    expect(headerOf(init, 'authorization')).toBe('Bearer t1');
    expect(headerOf(init, 'content-type')).toBeNull();
  });

  it('Q-client-responses: JSON, 204, error codes and network failure', async () => {
    stubFetch(() => Promise.resolve(json(200, { a: 1 })));
    await expect(request('/x')).resolves.toEqual({ a: 1 });

    stubFetch(() => Promise.resolve(new Response(null, { status: 204 })));
    await expect(request('/x', { method: 'DELETE' })).resolves.toBeUndefined();

    const cases: [() => Promise<Response>, number, string][] = [
      [() => Promise.resolve(json(409, { error: 'conflict' })), 409, 'conflict'],
      [() => Promise.resolve(new Response('Internal error', { status: 500 })), 500, 'http_error'],
      [() => Promise.reject(new TypeError('Failed to fetch')), 0, 'network_error'],
    ];
    for (const [impl, status, code] of cases) {
      stubFetch(impl);
      const err = await rejection(request('/x'));
      expect(err, code).toBeInstanceOf(ApiError);
      expect(err, code).toMatchObject({ status, code });
    }
  });

  it('Q-client-401: rejects unauthorized and logs the store out', async () => {
    await signIn();
    stubFetch(() => Promise.resolve(json(401, { error: 'unauthorized' })));
    const err = await rejection(request('/products'));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, code: 'unauthorized' });
    expect(getToken()).toBeNull();
  });
});

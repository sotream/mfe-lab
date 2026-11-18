/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getToken, login, logout, useAuth, type AuthState } from '../src/index.ts';

const admin = { id: 1, email: 'admin@lab.test', role: 'admin' } as const;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const stubFetch = (impl: () => Promise<Response>) => {
  const fetch = vi.fn(impl);
  vi.stubGlobal('fetch', fetch);
  return fetch;
};
const deferred = () => {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => (resolve = r));
  return { promise, resolve };
};

// Renders the whole state so tests can read it from the DOM.
const Probe = () => <pre data-testid="state">{JSON.stringify(useAuth((s) => s))}</pre>;
const state = () => JSON.parse(screen.getByTestId('state').textContent ?? 'null') as AuthState;
const anonymous: AuthState = { user: null, token: null, status: 'anonymous' };
const mountProbe = () => act(async () => void render(<Probe />));
const loginAs = (email = admin.email) => act(() => login(email, 'lab12345'));

afterEach(() => {
  cleanup();
  logout();
  vi.unstubAllGlobals();
});

describe('auth-store', () => {
  it('Q-store-initial: anonymous state and no token', async () => {
    await mountProbe();
    expect(state()).toEqual(anonymous);
    expect(getToken()).toBeNull();
  });

  it('Q-store-login: posts credentials, loading while pending, then authenticated', async () => {
    await mountProbe();
    const pending = deferred();
    const fetch = stubFetch(() => pending.promise);
    let done!: Promise<void>;
    await act(async () => {
      done = login(admin.email, 'lab12345');
    });
    expect(state().status).toBe('loading');

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/login');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({ email: admin.email, password: 'lab12345' });

    await act(async () => {
      pending.resolve(json(200, { token: 't1', user: admin }));
      await done;
    });
    expect(state()).toEqual({ user: admin, token: 't1', status: 'authenticated' });
    expect(getToken()).toBe('t1');
  });

  it('Q-store-login-fail: error code, http_error and network_error; stays anonymous', async () => {
    await mountProbe();
    const cases: [() => Promise<Response>, string][] = [
      [() => Promise.resolve(json(401, { error: 'invalid_credentials' })), 'invalid_credentials'],
      [() => Promise.resolve(json(500, {})), 'http_error'],
      [() => Promise.reject(new TypeError('Failed to fetch')), 'network_error'],
    ];
    for (const [impl, message] of cases) {
      stubFetch(impl);
      let err: unknown;
      await act(async () => {
        err = await login(admin.email, 'x').then(
          () => 'resolved',
          (e: unknown) => e,
        );
      });
      expect(err, message).toBeInstanceOf(Error);
      expect(err, message).toMatchObject({ message });
      expect(state(), message).toEqual(anonymous);
      expect(getToken(), message).toBeNull();
    }
  });

  it('Q-store-logout: logout returns to the anonymous state', async () => {
    await mountProbe();
    stubFetch(() => Promise.resolve(json(200, { token: 't1', user: admin })));
    await loginAs();
    expect(state().status).toBe('authenticated');
    act(() => logout());
    expect(state()).toEqual(anonymous);
    expect(getToken()).toBeNull();
  });

  it('Q-store-reactive: selector subscribers re-render on login and logout', async () => {
    const Email = () => <p data-testid="email">{useAuth((s) => s.user?.email ?? 'none')}</p>;
    await act(async () => void render(<Email />));
    const email = () => screen.getByTestId('email').textContent;
    expect(email()).toBe('none');
    stubFetch(() => Promise.resolve(json(200, { token: 't1', user: admin })));
    await loginAs();
    expect(email()).toBe(admin.email);
    act(() => logout());
    expect(email()).toBe('none');
  });

  it('Q-store-no-persist: nothing in localStorage, sessionStorage or cookies', async () => {
    stubFetch(() => Promise.resolve(json(200, { token: 't1', user: admin })));
    await loginAs();
    expect(getToken()).toBe('t1');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe('');
  });
});

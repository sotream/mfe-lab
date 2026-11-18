/** @vitest-environment jsdom */
import { login, logout } from '@mfe/auth-store';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from '../src/LoginPage.tsx';
import { RequireAuth } from '../src/RequireAuth.tsx';

const admin = { id: 1, email: 'admin@lab.test', role: 'admin' } as const;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const stubFetch = (impl: () => Promise<Response>) => {
  const fetch = vi.fn(impl);
  vi.stubGlobal('fetch', fetch);
  return fetch;
};
const okLogin = () => Promise.resolve(json(200, { token: 't1', user: admin }));

// Shows the current location so redirects are observable from the DOM.
const Location = () => {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{pathname + search}</output>;
};
const routes = [
  {
    element: (
      <>
        <Outlet />
        <Location />
      </>
    ),
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/inspector', element: <p>inspector page</p> },
      {
        path: '/products',
        element: (
          <RequireAuth>
            <p>products page</p>
          </RequireAuth>
        ),
      },
      {
        path: '/',
        element: (
          <RequireAuth>
            <p>home page</p>
          </RequireAuth>
        ),
      },
    ],
  },
];

// React 19 + RTL: flush async work inside an awaited act(), as in T4.
const settle = () => new Promise((r) => setTimeout(r, 0));
const start = (url: string) =>
  act(async () => {
    render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [url] })} />);
    await settle();
  });
const click = (el: HTMLElement) =>
  act(async () => {
    fireEvent.click(el);
    await settle();
  });
const location = () => screen.getByTestId('location').textContent;
const signIn = async () => {
  stubFetch(okLogin);
  await act(() => login(admin.email, 'lab12345'));
};
const submit = async (email: string, password: string) => {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  await click(screen.getByRole('button', { name: 'Sign in' }));
};

afterEach(() => {
  cleanup();
  logout();
  vi.unstubAllGlobals();
});

describe('RequireAuth', () => {
  it('Q-guard-redirect: anonymous is sent to /login with an encoded next', async () => {
    await start('/products?x=1');
    expect(location()).toBe('/login?next=%2Fproducts%3Fx%3D1');
    expect(screen.queryByText('products page')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Login' })).toBeTruthy();
  });

  it('Q-guard-ok: authenticated renders the children', async () => {
    await signIn();
    await start('/products');
    expect(screen.getByText('products page')).toBeTruthy();
    expect(location()).toBe('/products');
  });

  it('Q-guard-reactive: logout on a guarded route redirects to /login', async () => {
    await signIn();
    await start('/products');
    expect(screen.getByText('products page')).toBeTruthy();
    await act(async () => {
      logout();
      await settle();
    });
    expect(location()).toMatch(/^\/login(\?|$)/);
    expect(screen.queryByText('products page')).toBeNull();
  });
});

describe('LoginPage', () => {
  it('Q-login-render: heading, labelled inputs, button and demo accounts', async () => {
    await start('/login');
    expect(screen.getByRole('heading', { name: 'Login' })).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    const text = document.body.textContent ?? '';
    for (const s of ['admin@lab.test', 'editor@lab.test', 'viewer@lab.test', 'lab12345']) {
      expect(text, s).toContain(s);
    }
    expect(text).toMatch(/demo/i);
  });

  it('Q-login-success: lands on next after a successful login', async () => {
    const fetch = stubFetch(okLogin);
    await start('/login?next=%2Fproducts');
    await submit(admin.email, 'lab12345');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(location()).toBe('/products');
    expect(screen.getByText('products page')).toBeTruthy();
  });

  it('Q-login-next-safe: absolute and protocol-relative next go to /', async () => {
    for (const next of ['https%3A%2F%2Fevil.test', '%2F%2Fevil.test']) {
      stubFetch(okLogin);
      await start(`/login?next=${next}`);
      await submit(admin.email, 'lab12345');
      expect(location(), next).toBe('/');
      expect(screen.getByText('home page')).toBeTruthy();
      cleanup();
      logout();
    }
  });

  it('Q-login-fail: 401 and other failures show their alert and stay on /login', async () => {
    const cases: [() => Promise<Response>, string][] = [
      [
        () => Promise.resolve(json(401, { error: 'invalid_credentials' })),
        'Invalid email or password',
      ],
      [() => Promise.resolve(json(500, {})), 'Login failed, try again'],
    ];
    for (const [impl, message] of cases) {
      stubFetch(impl);
      await start('/login');
      await submit(admin.email, 'wrong');
      expect(screen.getByRole('alert').textContent, message).toContain(message);
      expect(location()).toBe('/login');
      cleanup();
    }
  });

  it('Q-login-loading: button disabled while pending, second click sends nothing', async () => {
    let resolve!: (r: Response) => void;
    const fetch = stubFetch(() => new Promise<Response>((r) => (resolve = r)));
    await start('/login');
    await submit(admin.email, 'lab12345');
    const button = screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await click(button);
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve(json(401, { error: 'invalid_credentials' }));
      await settle();
    });
  });
});

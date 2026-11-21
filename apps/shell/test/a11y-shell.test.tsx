/** @vitest-environment jsdom */
import { login, logout } from '@mfe/auth-store';
import { emit } from '@mfe/events';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const Stub = () => <h3>remote heading</h3>;
vi.mock('@module-federation/enhanced/runtime', () => ({
  getInstance: () => null,
  registerPlugins: vi.fn(),
  init: vi.fn(),
  registerRemotes: vi.fn(),
  loadRemote: vi.fn(() => Promise.resolve({ default: Stub, buildVersion: 'test' })),
}));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/login') {
        const email = JSON.parse(String(init?.body)).email as string;
        return json(200, { token: 't', user: { id: 1, email, role: email.split('@')[0] } });
      }
      return json(200, []);
    }),
  );
});
afterEach(() => {
  cleanup();
  logout();
  vi.unstubAllGlobals();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const load = async () => (await import('../src/App.tsx')).router;
const navigate = async (to: string | number) => {
  const router = await load();
  await act(async () => {
    await router.navigate(to as string);
    await sleep(30);
  });
};
const mount = async (path: string, as?: string) => {
  if (as) await act(() => login(`${as}@lab.test`, 'lab12345'));
  window.history.pushState({}, '', path);
  const router = await load();
  await act(async () => {
    await router.navigate(path);
    render(<RouterProvider router={router} />);
    await sleep(30);
  });
};
const h1 = () => screen.getByRole('heading', { level: 1 });

describe('shell a11y', () => {
  it('Q-title: each top-level route sets its title', async () => {
    await mount('/', 'admin');
    expect(document.title).toBe('Home – mfe-lab');
    await navigate('/products');
    expect(document.title).toBe('Products – mfe-lab');
    await navigate('/dashboard');
    expect(document.title).toBe('Dashboard – mfe-lab');
    await navigate('/inspector');
    expect(document.title).toBe('Inspector – mfe-lab');
    await navigate('/products/7');
    expect(document.title).toBe('Products – mfe-lab'); // the remote's own title is not set by a stub
  });

  it('Q-title: /login signed out is "Sign in – mfe-lab"', async () => {
    await mount('/login');
    expect(document.title).toBe('Sign in – mfe-lab');
  });

  it('Q-route-focus: after navigate the page h1 has focus, back included', async () => {
    await mount('/', 'admin');
    await navigate('/products');
    expect(document.activeElement).toBe(h1());
    expect(h1().textContent).toBe('Products');
    expect(h1().getAttribute('tabindex')).toBe('-1');

    await navigate('/inspector');
    expect(document.activeElement).toBe(h1());
    expect(h1().textContent).toBe('Federation inspector');

    await navigate(-1);
    expect(h1().textContent).toBe('Products');
    expect(document.activeElement).toBe(h1());
  });

  it('Q-route-focus: nested detail route focuses the shell Products h1', async () => {
    await mount('/products', 'admin');
    await navigate('/products/7');
    expect(h1().textContent).toBe('Products');
    expect(document.activeElement).toBe(h1());
  });

  it('Q-route-focus: the first render does not steal focus', async () => {
    await mount('/dashboard', 'admin');
    expect(h1().textContent).toBe('Dashboard');
    expect(document.activeElement).toBe(document.body);
  });

  it('Q-skip-link: first focusable element, links to #main', async () => {
    await mount('/', 'admin');
    const focusable = document.querySelector(
      'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    ) as HTMLAnchorElement;
    expect(focusable.tagName).toBe('A');
    expect(focusable.classList.contains('skip-link')).toBe(true);
    expect(focusable.getAttribute('href')).toBe('#main');
    expect(focusable.textContent).toBe('Skip to content');

    const main = document.getElementById('main') as HTMLElement;
    expect(main.tagName).toBe('MAIN');
    expect(main.getAttribute('tabindex')).toBe('-1');
    // Activation moving focus to #main is covered by E-skip-link in e2e (jsdom has no hash focus).
  });

  it('Q-headings: Home has one h1, frame names as h2, remote headings h3', async () => {
    await mount('/', 'admin');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(h1().textContent).toBe('One page, three independent apps');
    for (const name of ['products', 'dashboard']) {
      const section = document.querySelector(`section[data-remote="${name}"]`) as HTMLElement;
      expect(within(section).getByRole('heading', { level: 2, name })).toBeTruthy();
      expect(
        within(section).getByRole('heading', { level: 3, name: 'remote heading' }),
      ).toBeTruthy();
    }
  });

  it('Q-headings: /products and /products/7 have h1 Products; /dashboard has h1 Dashboard', async () => {
    await mount('/products', 'admin');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(h1().textContent).toBe('Products');
    expect(screen.getByRole('heading', { level: 2, name: 'products' })).toBeTruthy();
    await navigate('/products/7');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(h1().textContent).toBe('Products');
    await navigate('/dashboard');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(h1().textContent).toBe('Dashboard');
    expect(screen.getByRole('heading', { level: 2, name: 'dashboard' })).toBeTruthy();
  });

  describe('Q-announce: live region', () => {
    const region = () => {
      const all = [
        ...document.querySelectorAll<HTMLElement>('[role="status"][aria-live="polite"]'),
      ];
      return all.find((r) => !r.closest('main')) as HTMLElement;
    };

    it('is always in the DOM, outside main, and shows an emitted message', async () => {
      await mount('/', 'admin');
      expect(region()).toBeTruthy();
      expect(region().textContent).toBe('');
      await act(async () => {
        emit('a11y:announce', { message: 'Hello there' });
        await sleep(30);
      });
      expect(region().textContent).toBe('Hello there');
    });

    it('re-announces the same message: cleared, then set again', async () => {
      await mount('/', 'admin');
      const seen: string[] = [];
      const mo = new MutationObserver(() => void seen.push(region().textContent ?? ''));
      mo.observe(document.body, { childList: true, characterData: true, subtree: true });
      await act(async () => {
        emit('a11y:announce', { message: 'Same' });
        await sleep(30);
      });
      seen.length = 0;
      await act(async () => {
        emit('a11y:announce', { message: 'Same' });
        await sleep(30);
        await new Promise<void>((r) => queueMicrotask(r));
      });
      mo.disconnect();
      expect(region().textContent).toBe('Same');
      expect(seen).toContain('');
      expect(seen.lastIndexOf('Same')).toBeGreaterThan(seen.indexOf(''));
    });
  });
});

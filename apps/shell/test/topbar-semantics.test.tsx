/** @vitest-environment jsdom */
import { login, logout } from '@mfe/auth-store';
import { emit } from '@mfe/events';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const Stub = () => <h3>remote heading</h3>;
vi.mock('@module-federation/enhanced/runtime', () => ({
  getInstance: () => null,
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

const before = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const setLocale = (locale: 'de' | 'en') =>
  act(async () => {
    document.documentElement.lang = locale;
    emit('locale:changed', { locale });
    await sleep(30);
  });

describe('shell top bar semantics', () => {
  it('Q-topbar-structure: Main nav holds one list of 4 links and nothing else', async () => {
    await mount('/', 'admin');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const lists = within(nav).getAllByRole('list');
    expect(lists).toHaveLength(1);
    const items = within(lists[0] as HTMLElement).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(['Home', 'Products', 'Dashboard', 'Inspector']);
    expect(
      items.every(
        (li) => li.children.length === 1 && li.firstElementChild === within(li).getByRole('link'),
      ),
    ).toBe(true);
    expect(within(nav).queryAllByRole('button')).toHaveLength(0);
    expect(within(nav).queryByRole('group')).toBeNull();
    expect(within(nav).queryByText('admin@lab.test')).toBeNull();
    expect(within(nav).queryByRole('button', { name: 'Log out' })).toBeNull();
  });

  it('Q-topbar-structure: the active link keeps aria-current=page', async () => {
    await mount('/products', 'admin');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Products' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Home' }).hasAttribute('aria-current')).toBe(
      false,
    );
  });

  it('Q-topbar-structure: wordmark, nav, language group and user block sit in the banner in order', async () => {
    await mount('/', 'admin');
    const banner = screen.getByRole('banner');
    const nav = within(banner).getByRole('navigation', { name: 'Main' });
    const brand = within(banner).getByRole('link', { name: 'mfe-lab' });
    const lang = within(banner).getByRole('group', { name: 'Language' });
    const logout = within(banner).getByRole('button', { name: 'Log out' });
    const email = within(banner).getByText('admin@lab.test', { exact: true });
    expect(nav.contains(brand)).toBe(false);
    for (const el of [lang, logout, email]) expect(nav.contains(el)).toBe(false);
    expect(before(brand, nav)).toBe(true);
    expect(before(nav, lang)).toBe(true);
    expect(before(lang, email)).toBe(true);
    expect(before(email, logout)).toBe(true);
  });

  it('Q-topbar-structure: signed out, the Sign in link is in the banner, not in nav', async () => {
    await mount('/inspector');
    const banner = screen.getByRole('banner');
    const nav = within(banner).getByRole('navigation', { name: 'Main' });
    const login = within(banner).getByRole('link', { name: 'Login' });
    expect(nav.contains(login)).toBe(false);
    expect(within(banner).getByRole('group', { name: 'Language' })).toBeTruthy();
  });

  it('Q-topbar-structure: the nav is named Hauptnavigation in German', async () => {
    await mount('/', 'admin');
    await setLocale('de');
    const nav = screen.getByRole('navigation', { name: 'Hauptnavigation' });
    expect(within(nav).getAllByRole('link')).toHaveLength(4);
    expect(within(nav).queryAllByRole('button')).toHaveLength(0);
    await setLocale('en');
  });
});

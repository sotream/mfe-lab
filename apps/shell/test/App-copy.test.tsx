/** @vitest-environment jsdom */
import { login, logout } from '@mfe/auth-store';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const Stub = () => <p>remote stub</p>;
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

const mount = async (path: string, as?: string) => {
  if (as) await act(() => login(`${as}@lab.test`, 'lab12345'));
  window.history.pushState({}, '', path);
  const { router } = await import('../src/App.tsx');
  await act(async () => {
    await router.navigate(path);
    render(<RouterProvider router={router} />);
    await new Promise((r) => setTimeout(r, 30));
  });
};
const allText = () => [...document.body.querySelectorAll('*')].map((e) => e.textContent ?? '');

describe('shell copy', () => {
  it('Q-home-copy: h1 and lede', async () => {
    await mount('/', 'admin');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'One page, three independent apps',
    );
    expect(
      screen.getByText(
        'The shell loads products and dashboard at runtime. Each is built and deployed on its own.',
      ),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain(':3000'); // Q-lead
  });

  it('Q-nav-user: email and role chip are separate, no middle dot', async () => {
    await mount('/', 'admin');
    const email = screen.getByText('admin@lab.test', { exact: true });
    const role = screen.getByText('admin', { exact: true });
    expect(email).not.toBe(role);
    expect(email.contains(role) || role.contains(email)).toBe(false);
    expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy();
    expect(allText().filter((t) => t.includes(' · '))).toEqual([]);
  });

  it('Q-nav-signed-out: Login link stays', async () => {
    await mount('/inspector');
    expect(within(document.body).getByRole('link', { name: 'Login' })).toBeTruthy();
  });

  it('Q-footer: shell and build stamp, no middle dot', async () => {
    await mount('/', 'admin');
    const footer = document.querySelector('footer') as HTMLElement;
    expect(footer.textContent).toContain('shell');
    expect(footer.textContent).toContain('build ');
    expect(footer.textContent).not.toContain('·');
  });
});

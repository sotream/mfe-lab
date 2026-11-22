/** @vitest-environment jsdom */
import { login, logout } from '@mfe/auth-store';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProductsPage from '../src/ProductsPage.tsx';

const NOTE = 'Demo admin: changes that affect everyone are disabled';
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
const product = {
  id: 1,
  sku: 'SKU-0001',
  name: 'Product 1',
  price_cents: 100,
  stock: 1,
  created_at: '2026-10-01T12:00:00.000Z',
};

const mount = async (demo: boolean) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/auth/login')
        return json({ token: 't', user: { id: 1, email: 'a@lab.test', role: 'admin', demo } });
      return json({ items: [product], total: 1, page: 1, limit: 10 });
    }),
  );
  await act(() => login('a@lab.test', 'lab12345'));
  await act(async () => {
    render(
      <MemoryRouter>
        <ProductsPage />
      </MemoryRouter>,
    );
    await new Promise((r) => setTimeout(r, 20));
  });
  return screen.getByRole('button', { name: 'Delete SKU-0001' });
};

afterEach(() => {
  cleanup();
  logout();
  vi.unstubAllGlobals();
});

describe('locked delete button', () => {
  it('demo user: disabled, aria-disabled, described by the demo note', async () => {
    const del = await mount(true);
    expect((del as HTMLButtonElement).disabled).toBe(true);
    expect(del.getAttribute('aria-disabled')).toBe('true');
    const ids = del.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(ids.map((id) => document.getElementById(id)?.textContent).join(' ')).toBe(NOTE);
  });

  it('non-demo admin: enabled', async () => {
    expect(((await mount(false)) as HTMLButtonElement).disabled).toBe(false);
  });
});

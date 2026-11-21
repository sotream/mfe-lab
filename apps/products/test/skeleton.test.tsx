/** @vitest-environment jsdom */
// Q-surfaces (products). ASSUMPTION: while the list request is pending the real toolbar renders and the table is busy.
import { login, logout } from '@mfe/auth-store';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProductsPage from '../src/ProductsPage.tsx';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  cleanup();
  logout();
  vi.unstubAllGlobals();
});

describe('products loading state', () => {
  it('Q-surfaces: pending list shows the real search, a busy table and 10 skeleton rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url === '/api/auth/login'
          ? Promise.resolve(
              json(200, { token: 't', user: { id: 1, email: 'admin@lab.test', role: 'admin' } }),
            )
          : new Promise<Response>(() => {}),
      ),
    );
    await act(() => login('admin@lab.test', 'lab12345'));
    await act(async () => {
      render(
        <MemoryRouter>
          <ProductsPage />
        </MemoryRouter>,
      );
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add product/ })).toBeTruthy();
    const table = document.querySelector('table')!;
    expect(table.getAttribute('aria-busy')).toBe('true');
    const rows = table.querySelectorAll('tbody tr[aria-hidden="true"]');
    expect(rows).toHaveLength(10);
    expect(table.querySelectorAll('tbody tr')).toHaveLength(10);
    expect(table.querySelector('.ds1-skeleton')).not.toBeNull();
    // the announcement stays
    expect(screen.getByRole('status').textContent).toContain('Loading products');
  });
});

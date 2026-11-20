/** @vitest-environment jsdom */
import { login, logout } from '@mfe/auth-store';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProductsPage from '../src/ProductsPage.tsx';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const row = (sku: string, id: number) => ({
  id,
  sku,
  name: sku,
  price_cents: 100,
  stock: 1,
  created_at: '2026-10-01T12:00:00.000Z',
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  cleanup();
  logout();
  vi.unstubAllGlobals();
});

describe('ProductsPage user switch', () => {
  it('Q-user-switch: after switching user only the new user rows are shown', async () => {
    // The list answers by whoever logged in last; the second list is held back.
    let current = '';
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let lists = 0;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/login') {
        const email = JSON.parse(String(init?.body)).email as string;
        current = email;
        const id = email.startsWith('editor') ? 2 : 3;
        return json(200, { token: `t-${id}`, user: { id, email, role: email.split('@')[0] } });
      }
      if (url === '/api/flags') return json(404, { error: 'not_found' });
      lists++;
      const mine = current;
      if (lists > 1) await gate;
      const items = mine.startsWith('editor') ? [row('ROWS-A', 1)] : [row('ROWS-B', 2)];
      return json(200, { items, total: 1, page: 1, limit: 10 });
    });
    vi.stubGlobal('fetch', fetch);

    await act(() => login('editor@lab.test', 'lab12345'));
    await act(async () => {
      render(
        <MemoryRouter>
          <ProductsPage />
        </MemoryRouter>,
      );
      await sleep(20);
    });
    expect(screen.getAllByText('ROWS-A').length).toBeGreaterThan(0);

    await act(() => login('viewer@lab.test', 'lab12345'));
    await act(() => sleep(20));
    expect(lists).toBeGreaterThan(1);
    expect(screen.queryByText('ROWS-A')).toBeNull();

    await act(async () => {
      release();
      await sleep(20);
    });
    expect(screen.getAllByText('ROWS-B').length).toBeGreaterThan(0);
    expect(screen.queryByText('ROWS-A')).toBeNull();
  });
});

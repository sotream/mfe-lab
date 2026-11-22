/** @vitest-environment jsdom */
// T49 Q-search-back (RFC 0007): search, page, open a result, go Back: the search text, the results and the
// page are all still there.
import type { Product } from '@mfe/api-client';
import { login, logout } from '@mfe/auth-store';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import ProductsApp from '../src/ProductsApp.tsx';

beforeAll(() => {
  const proto = HTMLDialogElement.prototype;
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const data: Product[] = Array.from({ length: 45 }, (_, i) => ({
  id: i + 1,
  sku: `SKU-${String(i + 1).padStart(4, '0')}`,
  name: i < 40 ? `Druck ${i + 1}` : `Ventil ${i + 1}`,
  price_cents: (i + 1) * 100,
  stock: i + 1,
  created_at: '2026-10-01T12:00:00.000Z',
}));

const server = () => {
  const lists: URLSearchParams[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url, 'http://x');
      if (u.pathname === '/api/auth/login') {
        const email = JSON.parse(String(init?.body)).email as string;
        return json(200, { token: 't', user: { id: 1, email, role: email.split('@')[0] } });
      }
      const m = /^\/api\/products\/(\d+)$/.exec(u.pathname);
      if (m)
        return json(
          200,
          data.find((p) => p.id === Number(m[1])),
        );
      if (u.pathname !== '/api/products') return json(200, []);
      lists.push(u.searchParams);
      const page = Number(u.searchParams.get('page') ?? 1);
      const limit = Number(u.searchParams.get('limit') ?? 20);
      const q = (u.searchParams.get('q') ?? '').toLowerCase();
      const hits = data.filter((p) => p.name.toLowerCase().includes(q));
      return json(200, {
        items: hits.slice((page - 1) * limit, page * limit),
        total: hits.length,
        page,
        limit,
      });
    }),
  );
  return lists;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const flush = (ms = 0) => act(() => sleep(ms));
const click = (el: HTMLElement) => act(async () => void (fireEvent.click(el), await sleep(0)));
const rows = () => Array.from(document.querySelectorAll('tbody tr')).map((r) => r.textContent);
const box = () => screen.getByRole('searchbox', { name: 'Search' }) as HTMLInputElement;

afterEach(() => {
  cleanup();
  logout();
  vi.unstubAllGlobals();
});

describe('Q-search-back', () => {
  it('list -> detail -> Back keeps the search text, the results and the page', async () => {
    server();
    await act(() => login('viewer@lab.test', 'lab12345'));
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/*" element={<ProductsApp />} />
          </Routes>
        </MemoryRouter>,
      );
      await sleep(0);
    });
    await act(() => void fireEvent.change(box(), { target: { value: 'Druck' } }));
    await flush(500); // past the debounce
    await click(screen.getByRole('button', { name: 'Next' }));
    const before = rows();
    expect(before.length).toBeGreaterThan(0); // page 2 of the 40 hits
    expect(before.join()).not.toContain('Druck 1 '); // not page 1
    expect(before.every((r) => r?.includes('Druck'))).toBe(true);

    await click(screen.getByRole('link', { name: before[0]!.match(/Druck \d+/)![0] }));
    expect(screen.getByRole('heading', { level: 3, name: /^Druck \d+$/ })).toBeTruthy();
    await click(screen.getByRole('link', { name: 'Back to products' }));
    await flush(500); // a mount-time debounce would fire here and reset the search

    expect(box().value).toBe('Druck');
    expect(rows()).toEqual(before);
  });

  it('Back does not refetch page 1 without the search', async () => {
    const lists = server();
    await act(() => login('viewer@lab.test', 'lab12345'));
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/*" element={<ProductsApp />} />
          </Routes>
        </MemoryRouter>,
      );
      await sleep(0);
    });
    await act(() => void fireEvent.change(box(), { target: { value: 'Druck' } }));
    await flush(500);
    await click(screen.getByRole('link', { name: 'Druck 1' }));
    lists.length = 0;
    await click(screen.getByRole('link', { name: 'Back to products' }));
    await flush(500);
    expect(lists.length).toBeGreaterThan(0);
    for (const p of lists) expect(p.get('q')).toBe('Druck');
  });
});

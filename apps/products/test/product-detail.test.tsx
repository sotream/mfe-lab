/** @vitest-environment jsdom */
import type { Product } from '@mfe/api-client';
import { login, logout } from '@mfe/auth-store';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import ProductsApp from '../src/ProductsApp.tsx';
import ProductsPage from '../src/ProductsPage.tsx';

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
const data: Product[] = Array.from({ length: 30 }, (_, i) => ({
  id: i + 1,
  sku: `SKU-${String(i + 1).padStart(4, '0')}`,
  name: `Product ${i + 1}`,
  price_cents: (i + 1) * 100,
  stock: i + 1,
  created_at: '2026-10-01T12:00:00.000Z',
}));

// detail: status code for GET /api/products/:id (200 serves from `data`)
const server = (detail: () => number = () => 200) => {
  const paths: string[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url, 'http://x');
    if (u.pathname === '/api/auth/login') {
      const email = JSON.parse(String(init?.body)).email as string;
      return json(200, { token: 't', user: { id: 1, email, role: email.split('@')[0] } });
    }
    paths.push(u.pathname);
    const m = /^\/api\/products\/([^/]+)$/.exec(u.pathname);
    if (m) {
      const status = detail();
      if (status === 404) return json(404, { error: 'not_found' });
      if (status !== 200) return json(status, { error: 'internal' });
      return json(
        200,
        data.find((p) => p.id === Number(m[1])),
      );
    }
    const page = Number(u.searchParams.get('page') ?? 1);
    const limit = Number(u.searchParams.get('limit') ?? 20);
    return json(200, {
      items: data.slice((page - 1) * limit, page * limit),
      total: data.length,
      page,
      limit,
    });
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, paths };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mount = async (path: string) => {
  await act(() => login('viewer@lab.test', 'lab12345'));
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/*" element={<ProductsApp />} />
        </Routes>
      </MemoryRouter>,
    );
    await sleep(0);
  });
};
const click = (el: HTMLElement) =>
  act(async () => {
    fireEvent.click(el);
    await sleep(0);
  });

afterEach(() => {
  cleanup();
  logout();
  vi.unstubAllGlobals();
});

describe('ProductDetail via ProductsApp', () => {
  it('Q-product-detail: found renders name, fields and requests /products/7', async () => {
    const api = server();
    await mount('/7');
    expect(screen.getByRole('heading', { level: 2, name: 'Product 7' })).toBeTruthy();
    const dl = document.querySelector('dl') as HTMLElement;
    const dd = (label: string) =>
      Array.from(dl.querySelectorAll('dt')).find((t) => t.textContent === label)?.nextElementSibling
        ?.textContent;
    expect(dd('SKU')).toBe('SKU-0007');
    expect(dd('Stock')).toBe('7');
    expect(dd('Price')).toBe('$7.00');
    expect(dd('Created')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(api.paths.some((p) => p.endsWith('/products/7'))).toBe(true);
  });

  it('Q-product-detail: 404 shows Product not found', async () => {
    server(() => 404);
    await mount('/7');
    expect(screen.getByText('Product not found')).toBeTruthy();
  });

  it('Q-product-detail: 500 shows alert, Retry refetches', async () => {
    let status = 500;
    const api = server(() => status);
    await mount('/7');
    expect(screen.getByRole('alert')).toBeTruthy();
    const before = api.paths.filter((p) => p.endsWith('/products/7')).length;
    status = 200;
    await click(screen.getByRole('button', { name: 'Retry' }));
    expect(api.paths.filter((p) => p.endsWith('/products/7')).length).toBe(before + 1);
    expect(screen.getByRole('heading', { level: 2, name: 'Product 7' })).toBeTruthy();
  });

  it('Q-product-detail: non-numeric id shows Product not found, no request', async () => {
    const api = server();
    await mount('/abc');
    expect(screen.getByText('Product not found')).toBeTruthy();
    expect(api.paths.some((p) => p.includes('/products/abc'))).toBe(false);
  });

  it('Q-product-detail: list state survives list -> detail -> back', async () => {
    server();
    await mount('/');
    await click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Page 2 of 3')).toBeTruthy();
    await click(screen.getByRole('link', { name: 'Product 11' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Product 11' })).toBeTruthy();
    await click(screen.getByRole('link', { name: 'Back to products' }));
    expect(screen.getByText('Page 2 of 3')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Product 11' })).toBeTruthy();
  });
});

describe('ProductsPage links', () => {
  it('Q-products-page-links: name is a link to /products/<id>', async () => {
    server();
    await act(() => login('viewer@lab.test', 'lab12345'));
    await act(async () => {
      render(
        <MemoryRouter>
          <ProductsPage />
        </MemoryRouter>,
      );
      await sleep(0);
    });
    const link = screen.getByRole('link', { name: 'Product 3' });
    expect(link.getAttribute('href')).toBe('/products/3');
  });
});

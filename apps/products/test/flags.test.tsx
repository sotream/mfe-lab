/** @vitest-environment jsdom */
import type { Product } from '@mfe/api-client';
import { login, logout } from '@mfe/auth-store';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Component, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProductsPage from '../src/ProductsPage.tsx';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const data: Product[] = Array.from({ length: 3 }, (_, i) => ({
  id: i + 1,
  sku: `SKU-${i + 1}`,
  name: `Product ${i + 1}`,
  price_cents: 100,
  stock: 1,
  created_at: '2026-10-01T12:00:00.000Z',
}));

const server = (flags: Record<string, boolean>) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url, 'http://x');
      if (u.pathname === '/api/auth/login') {
        const email = JSON.parse(String(init?.body)).email as string;
        return json(200, { token: 't', user: { id: 1, email, role: email.split('@')[0] } });
      }
      if (u.pathname === '/api/flags')
        return json(
          200,
          Object.entries(flags).map(([name, enabled]) => ({ name, enabled, description: name })),
        );
      return json(200, { items: data, total: data.length, page: 1, limit: 20 });
    }),
  );

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    return this.state.error ? <p>caught: {this.state.error.message}</p> : this.props.children;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mount = async () => {
  await act(() => login('viewer@lab.test', 'lab12345'));
  await act(async () => {
    render(
      <Boundary>
        <MemoryRouter>
          <ProductsPage />
        </MemoryRouter>
      </Boundary>,
    );
    await sleep(50);
  });
};

afterEach(() => {
  cleanup();
  logout();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('products flags', () => {
  it('Q-crash-flag: products.crash on makes ProductsPage throw into the boundary', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    server({ 'products.crash': true, 'products.detailPage': true });
    await mount();
    expect(screen.getByText('caught: products.crash flag is on')).toBeTruthy();
  });

  it('Q-crash-flag: crash off renders the table', async () => {
    server({ 'products.crash': false, 'products.detailPage': true });
    await mount();
    expect(screen.queryByText(/caught:/)).toBeNull();
    expect(screen.getByText('Product 1')).toBeTruthy();
  });

  it('Q-detail-flag-off: detailPage off renders names as plain text', async () => {
    server({ 'products.crash': false, 'products.detailPage': false });
    await mount();
    expect(screen.getByText('Product 1')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Product 1' })).toBeNull();
  });

  it('Q-detail-flag-off: detailPage on links names', async () => {
    server({ 'products.crash': false, 'products.detailPage': true });
    await mount();
    expect(screen.getByRole('link', { name: 'Product 1' })).toBeTruthy();
  });
});

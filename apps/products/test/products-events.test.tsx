/** @vitest-environment jsdom */
import type { Product } from '@mfe/api-client';
import { login, logout } from '@mfe/auth-store';
import { onAny } from '@mfe/events';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import ProductsPage from '../src/ProductsPage.tsx';

beforeAll(() => {
  const proto = HTMLDialogElement.prototype;
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.show ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const products: Product[] = Array.from({ length: 3 }, (_, i) => ({
  id: i + 1,
  sku: `SKU-000${i + 1}`,
  name: `Product ${i + 1}`,
  price_cents: 100 * (i + 1),
  stock: i + 1,
  created_at: '2026-10-01T12:00:00.000Z',
}));

// Fake API; `fail` maps a method to a failing status.
const server = (fail: Partial<Record<string, number>> = {}) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      if (url === '/api/auth/login')
        return json(200, { token: 't', user: { id: 1, email: body.email, role: 'editor' } });
      const status = fail[method];
      if (status) return json(status, { error: 'nope' });
      if (method === 'GET')
        return json(200, { items: products, total: products.length, page: 1, limit: 10 });
      if (method === 'DELETE') return new Response(null, { status: 204 });
      if (method === 'POST')
        return json(201, { ...body, id: 999, created_at: '2026-11-20T00:00:00.000Z' });
      return json(200, { ...products[0], ...body });
    }),
  );
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settle = () => act(() => sleep(20));
const click = async (el: HTMLElement) => {
  await act(async () => {
    fireEvent.click(el);
    await sleep(20);
  });
};
const type = (el: HTMLElement, value: string) =>
  act(() => void fireEvent.change(el, { target: { value } }));
const button = (name: string) => screen.getByRole('button', { name });
const dialog = () => document.querySelector('dialog[open]') as HTMLElement;

const events: { name: string; detail: unknown }[] = [];
let off: () => void;

const mount = async () => {
  server_ready();
  await act(() => login('editor@lab.test', 'lab12345'));
  await act(async () => {
    render(
      <MemoryRouter>
        <ProductsPage />
      </MemoryRouter>,
    );
    await sleep(20);
  });
  events.length = 0;
  off = onAny((e) => events.push({ name: e.name, detail: e.detail }));
};
let server_ready = () => {};

afterEach(() => {
  off?.();
  cleanup();
  logout();
  vi.unstubAllGlobals();
});

describe('ProductsPage events', () => {
  it('Q-products-emit: create, edit and delete each emit one products:changed', async () => {
    server_ready = () => server();
    await mount();

    await click(button('Add product'));
    for (const [label, value] of Object.entries({
      SKU: 'NEW-1',
      Name: 'New one',
      Price: '1.50',
      Stock: '2',
    }))
      await type(within(dialog()).getByLabelText(label), value);
    await click(within(dialog()).getByRole('button', { name: 'Save' }));
    await settle();
    expect(events).toEqual([{ name: 'products:changed', detail: { id: 999, kind: 'created' } }]);

    events.length = 0;
    await click(button('Edit SKU-0002'));
    await type(within(dialog()).getByLabelText('Name'), 'Renamed');
    await click(within(dialog()).getByRole('button', { name: 'Save' }));
    await settle();
    expect(events).toEqual([{ name: 'products:changed', detail: { id: 2, kind: 'updated' } }]);

    events.length = 0;
    await click(button('Delete SKU-0003'));
    await click(within(dialog()).getByRole('button', { name: 'Delete' }));
    await settle();
    expect(events).toEqual([{ name: 'products:changed', detail: { id: 3, kind: 'deleted' } }]);
  });

  it('Q-products-no-emit-on-error: 409 on create and 500 on delete emit nothing', async () => {
    server_ready = () => server({ POST: 409, DELETE: 500 });
    await mount();

    await click(button('Add product'));
    for (const [label, value] of Object.entries({
      SKU: 'DUP',
      Name: 'Dup',
      Price: '1',
      Stock: '1',
    }))
      await type(within(dialog()).getByLabelText(label), value);
    await click(within(dialog()).getByRole('button', { name: 'Save' }));
    await settle();
    expect(screen.getByRole('alert').textContent).toContain('SKU already exists');
    await click(within(dialog()).getByRole('button', { name: 'Cancel' }));

    await click(button('Delete SKU-0001'));
    await click(within(dialog()).getByRole('button', { name: 'Delete' }));
    await settle();
    expect(screen.getByRole('alert').textContent).toContain('Could not');
    expect(events).toEqual([]);
  });
});

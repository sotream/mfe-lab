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

const server = (fail: Partial<Record<string, number>> = {}) =>
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
      const id = Number(url.split('/').at(-1));
      return json(200, { ...products.find((p) => p.id === id), ...body });
    }),
  );

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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

const announced: string[] = [];
let off: () => void;

const mount = async (fail: Partial<Record<string, number>> = {}) => {
  server(fail);
  await act(() => login('editor@lab.test', 'lab12345'));
  await act(async () => {
    render(
      <MemoryRouter>
        <ProductsPage />
      </MemoryRouter>,
    );
    await sleep(20);
  });
  announced.length = 0;
  off = onAny((e) => {
    if (e.name === 'a11y:announce') announced.push((e.detail as { message: string }).message);
  });
};

afterEach(() => {
  off?.();
  cleanup();
  logout();
  vi.unstubAllGlobals();
});

describe('ProductsPage announcements', () => {
  it('Q-announce: create, save and delete each announce their message', async () => {
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
    await act(() => sleep(20));
    expect(announced).toEqual(['Product NEW-1 created']);

    announced.length = 0;
    await click(button('Edit SKU-0002'));
    await type(within(dialog()).getByLabelText('Name'), 'Renamed');
    await click(within(dialog()).getByRole('button', { name: 'Save' }));
    await act(() => sleep(20));
    expect(announced).toEqual(['Product SKU-0002 saved']);

    announced.length = 0;
    await click(button('Delete SKU-0003'));
    await click(within(dialog()).getByRole('button', { name: 'Delete' }));
    await act(() => sleep(20));
    expect(announced).toEqual(['Product SKU-0003 deleted']);
  });

  it('Q-announce: a failed delete announces nothing', async () => {
    await mount({ DELETE: 500 });
    await click(button('Delete SKU-0001'));
    await click(within(dialog()).getByRole('button', { name: 'Delete' }));
    await act(() => sleep(20));
    expect(announced).toEqual([]);
  });
});

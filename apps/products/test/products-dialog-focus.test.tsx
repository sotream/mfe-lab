/** @vitest-environment jsdom */
import type { Product } from '@mfe/api-client';
import { login, logout } from '@mfe/auth-store';
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const click = (el: HTMLElement) =>
  act(async () => {
    fireEvent.click(el);
    await sleep(20);
  });
const button = (name: string) => screen.getByRole('button', { name });
const dialog = () => document.querySelector('dialog[open]') as HTMLElement;

// Like a keyboard user: focus the opener, then activate it.
const open = async (name: string) => {
  const opener = button(name);
  opener.focus();
  await click(opener);
  expect(dialog(), `dialog opened by ${name}`).not.toBeNull();
  return opener;
};

const mount = async () => {
  // Deleted rows really disappear from the list, so "row is gone" is observable.
  const data = [...products];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      if (url === '/api/auth/login')
        return json(200, { token: 't', user: { id: 1, email: body.email, role: 'editor' } });
      if (method === 'GET')
        return json(200, { items: data, total: data.length, page: 1, limit: 10 });
      const id = Number(url.split('/').at(-1));
      if (method === 'DELETE') {
        data.splice(
          data.findIndex((p) => p.id === id),
          1,
        );
        return new Response(null, { status: 204 });
      }
      if (method === 'POST')
        return json(201, { ...body, id: 999, created_at: '2026-11-20T00:00:00.000Z' });
      return json(200, { ...data.find((p) => p.id === id), ...body });
    }),
  );
  await act(() => login('editor@lab.test', 'lab12345'));
  await act(async () => {
    render(
      <MemoryRouter>
        <ProductsPage />
      </MemoryRouter>,
    );
    await sleep(20);
  });
};

afterEach(() => {
  cleanup();
  logout();
  vi.unstubAllGlobals();
});

describe('ProductsPage dialog focus return (WCAG 2.4.3)', () => {
  it('Q-dialog-focus: Save on create returns focus to Add product', async () => {
    await mount();
    const opener = await open('Add product');
    for (const [label, value] of Object.entries({
      SKU: 'NEW-1',
      Name: 'New thing',
      Price: '9.99',
      Stock: '3',
    }))
      await act(
        () => void fireEvent.change(within(dialog()).getByLabelText(label), { target: { value } }),
      );
    await click(within(dialog()).getByRole('button', { name: 'Save' }));
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(button('Add product'));
    expect(document.activeElement).toBe(opener);
  });

  it('Q-dialog-focus: Save on edit returns focus to that row Edit button', async () => {
    await mount();
    await open('Edit SKU-0002');
    await click(within(dialog()).getByRole('button', { name: 'Save' }));
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(button('Edit SKU-0002'));
  });

  it('Q-dialog-focus: confirming delete moves focus to Add product', async () => {
    await mount();
    await open('Delete SKU-0002');
    await click(within(dialog()).getByRole('button', { name: 'Delete' }));
    expect(dialog()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete SKU-0002' })).toBeNull();
    expect(document.activeElement).toBe(button('Add product'));
  });

  it.each(['Add product', 'Edit SKU-0002', 'Delete SKU-0002'])(
    'Q-dialog-focus: Cancel returns focus to the opener (%s)',
    async (name) => {
      await mount();
      const opener = await open(name);
      await click(within(dialog()).getByRole('button', { name: 'Cancel' }));
      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(opener);
    },
  );
});

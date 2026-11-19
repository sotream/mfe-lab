/** @vitest-environment jsdom */
import type { Product } from '@mfe/api-client';
import { login, logout } from '@mfe/auth-store';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import ProductsPage from '../src/ProductsPage.tsx';

// ---- test-environment shim: jsdom has no modal dialog support -------------------------
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

// ---- fake API behind a stubbed fetch ---------------------------------------------------
type Req = { method: string; path: string; params: Record<string, string>; body: unknown };
type Handler = (req: Req) => Response | undefined | Promise<Response | undefined>;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const makeProducts = (n: number): Product[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    sku: `SKU-${String(i + 1).padStart(4, '0')}`,
    name: `Product ${i + 1}`,
    price_cents: i === 0 ? 1234 : (i + 1) * 100,
    stock: i + 1,
    created_at: '2026-10-01T12:00:00.000Z',
  }));

const server = (data: Product[] = makeProducts(30), override?: Handler) => {
  const requests: Req[] = [];
  const list = ({ params }: Req) => {
    const page = Number(params.page ?? 1);
    const limit = Number(params.limit ?? 20);
    const q = (params.q ?? '').toLowerCase();
    const hits = data.filter((p) => `${p.name}\n${p.sku}`.toLowerCase().includes(q));
    return json(200, {
      items: hits.slice((page - 1) * limit, page * limit),
      total: hits.length,
      page,
      limit,
    });
  };
  const write = ({ method, path, body }: Req) => {
    const id = Number(path.split('/').at(-1));
    if (method === 'POST')
      return json(201, { ...(body as object), id: 999, created_at: '2026-11-18T00:00:00.000Z' });
    const index = data.findIndex((p) => p.id === id);
    if (method === 'DELETE') {
      data.splice(index, 1);
      return new Response(null, { status: 204 });
    }
    return json(200, { ...data[index], ...(body as object) });
  };
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url, 'http://x');
    const req: Req = {
      method: init?.method ?? 'GET',
      path: u.pathname,
      params: Object.fromEntries(u.searchParams),
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    };
    if (req.path === '/api/auth/login') {
      const email = (req.body as { email: string }).email;
      return json(200, { token: 't', user: { id: 1, email, role: email.split('@')[0] } });
    }
    requests.push(req);
    const res = await override?.(req);
    if (res) return res;
    return req.method === 'GET' ? list(req) : write(req);
  });
  vi.stubGlobal('fetch', fetch);
  const lists = () => requests.filter((r) => r.method === 'GET' && r.path === '/api/products');
  const writes = () => requests.filter((r) => r.method !== 'GET');
  return { requests, lists, writes, urls: () => fetch.mock.calls.map((c) => c[0]) };
};

// ---- React 19 + RTL: run every step inside an awaited act(), as in T4 -----------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const flush = (ms = 0) => act(() => sleep(ms));
const mount = async () => {
  await act(async () => {
    render(
      <MemoryRouter>
        <ProductsPage />
      </MemoryRouter>,
    );
    await sleep(0);
  });
};
const click = async (el: HTMLElement) => {
  await act(async () => {
    fireEvent.click(el);
    await sleep(0);
  });
};
const type = (el: HTMLElement, value: string) =>
  act(() => void fireEvent.change(el, { target: { value } }));
const as = async (role: 'admin' | 'editor' | 'viewer') => {
  await act(() => login(`${role}@lab.test`, 'lab12345'));
};

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const rows = () => Array.from(document.querySelectorAll('tbody tr'));
const openDialog = () => {
  const dialog = document.querySelector<HTMLElement>('dialog[open]');
  expect(dialog, 'an open dialog').not.toBeNull();
  return dialog as HTMLElement;
};
const describedText = (input: HTMLElement) =>
  (input.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');
const fill = async (
  dialog: HTMLElement,
  values: Record<'SKU' | 'Name' | 'Price' | 'Stock', string>,
) => {
  for (const [label, value] of Object.entries(values))
    await type(within(dialog).getByLabelText(label), value);
};

afterEach(() => {
  cleanup();
  logout();
  vi.unstubAllGlobals();
});

describe('ProductsPage: list', () => {
  it('Q-page-load: first request, rows, page count, Previous disabled', async () => {
    const api = server();
    await mount();
    expect(api.urls()[0]).toBe('/api/products?page=1&limit=10&sort=id&order=asc');
    expect(rows()).toHaveLength(10);
    const first = rows()[0]?.textContent ?? '';
    for (const s of ['SKU-0001', 'Product 1', '$12.34', '2026-10-01']) expect(first).toContain(s);
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
    expect((button('Previous') as HTMLButtonElement).disabled).toBe(true);
    expect((button('Next') as HTMLButtonElement).disabled).toBe(false);
  });

  it('Q-page-loading: status while the first request is pending', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    server(makeProducts(30), async (req) => {
      if (req.method === 'GET') await gate;
      return undefined;
    });
    await mount();
    expect(screen.getByRole('status').textContent).toContain('Loading products…');
    await act(async () => {
      release();
      await sleep(0);
    });
    expect(rows()).toHaveLength(10);
  });

  it('Q-page-error: 500 shows the alert, Retry refetches', async () => {
    let fail = true;
    const api = server(makeProducts(30), () =>
      fail ? json(500, { error: 'internal' }) : undefined,
    );
    await mount();
    expect(screen.getByRole('alert').textContent).toContain('Could not load products');
    fail = false;
    await click(button('Retry'));
    expect(api.lists()).toHaveLength(2);
    expect(rows()).toHaveLength(10);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Q-page-empty: no items shows the empty message', async () => {
    server([]);
    await mount();
    expect(screen.getByText('No products found')).toBeTruthy();
    expect(screen.getByText('Page 1 of 1')).toBeTruthy();
  });

  it('Q-sort: Price toggles price_cents asc then desc with aria-sort', async () => {
    const api = server();
    await mount();
    await click(button('Price'));
    expect(api.lists().at(-1)?.params).toMatchObject({ sort: 'price_cents', order: 'asc' });
    const th = button('Price').closest('th');
    expect(th?.getAttribute('aria-sort')).toBe('ascending');
    expect(button('SKU').closest('th')?.hasAttribute('aria-sort')).toBe(false);
    await click(button('Price'));
    expect(api.lists().at(-1)?.params).toMatchObject({ sort: 'price_cents', order: 'desc' });
    expect(button('Price').closest('th')?.getAttribute('aria-sort')).toBe('descending');

    const mapping: [string, string][] = [
      ['SKU', 'sku'],
      ['Name', 'name'],
      ['Stock', 'stock'],
      ['Created', 'created_at'],
    ];
    for (const [label, sort] of mapping) {
      await click(button(label));
      expect(api.lists().at(-1)?.params, label).toMatchObject({ sort, order: 'asc' });
    }
  });

  it('Q-search: debounced, one request with q and page 1; empty search omits q', async () => {
    const api = server();
    await mount();
    await click(button('Next'));
    const before = api.lists().length;
    const box = screen.getByRole('searchbox', { name: 'Search' });
    for (const v of ['v', 'va', 'val', 'valve']) {
      await type(box, v);
      await flush(50);
    }
    expect(api.lists()).toHaveLength(before);
    await flush(400);
    const searches = api.lists().slice(before);
    expect(searches).toHaveLength(1);
    expect(searches[0]?.params).toMatchObject({ q: 'valve', page: '1' });

    await type(box, '');
    await flush(400);
    expect(api.lists().at(-1)?.params).not.toHaveProperty('q');
  });

  it('Q-search-race: a slow earlier response never overwrites a newer one', async () => {
    let releaseFirst!: () => void;
    const slow = new Promise<void>((r) => (releaseFirst = r));
    server(makeProducts(30), async (req) => {
      if (req.params.q === 'Product 2') await slow;
      return undefined;
    });
    await mount();
    const box = screen.getByRole('searchbox', { name: 'Search' });
    await type(box, 'Product 2');
    await flush(400); // request for "Product 2" is now pending
    await type(box, 'SKU-0030');
    await flush(400); // request for "SKU-0030" resolves first
    await act(async () => {
      releaseFirst();
      await sleep(0);
    });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.textContent).toContain('SKU-0030');
  });

  it('Q-paging: Next requests page 2, Next disabled on the last page', async () => {
    const api = server();
    await mount();
    await click(button('Next'));
    expect(api.lists().at(-1)?.params).toMatchObject({ page: '2' });
    expect(screen.getByText('Page 2 of 3')).toBeTruthy();
    await click(button('Next'));
    expect(screen.getByText('Page 3 of 3')).toBeTruthy();
    expect((button('Next') as HTMLButtonElement).disabled).toBe(true);
    expect((button('Previous') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('ProductsPage: roles', () => {
  const actions = () => ({
    add: screen.queryByRole('button', { name: 'Add product' }),
    edit: screen.queryByRole('button', { name: 'Edit SKU-0001' }),
    del: screen.queryByRole('button', { name: 'Delete SKU-0001' }),
    header: screen.queryByRole('columnheader', { name: 'Actions' }),
  });

  it('Q-roles: viewer and anonymous see no actions; editor and admin do', async () => {
    for (const role of [null, 'viewer'] as const) {
      server();
      if (role) await as(role);
      await mount();
      expect(Object.values(actions()), String(role)).toEqual([null, null, null, null]);
      cleanup();
      logout();
    }
    for (const role of ['editor', 'admin'] as const) {
      server();
      await as(role);
      await mount();
      for (const [k, el] of Object.entries(actions())) expect(el, `${role} ${k}`).not.toBeNull();
      cleanup();
      logout();
    }
  });

  it('Q-role-reactive: switching editor to viewer hides actions without remount', async () => {
    server();
    await as('editor');
    await mount();
    expect(actions().add).not.toBeNull();
    await act(async () => {
      logout();
      await login('viewer@lab.test', 'lab12345');
    });
    expect(Object.values(actions())).toEqual([null, null, null, null]);
    expect(rows()).toHaveLength(10);
  });
});

describe('ProductsPage: create, edit, delete', () => {
  const values = { SKU: 'NEW-0001', Name: 'New thing', Price: '9.99', Stock: '3' };

  it('Q-create: valid form posts input, closes the dialog and reloads', async () => {
    const api = server();
    await as('editor');
    await mount();
    await click(button('Add product'));
    const dialog = openDialog();
    expect(within(dialog).getByRole('heading', { name: 'Add product' })).toBeTruthy();
    await fill(dialog, values);
    const listsBefore = api.lists().length;
    await click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(api.writes()).toEqual([
      expect.objectContaining({
        method: 'POST',
        path: '/api/products',
        body: { sku: 'NEW-0001', name: 'New thing', price_cents: 999, stock: 3 },
      }),
    ]);
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(api.lists().length).toBeGreaterThan(listsBefore);
    expect(api.lists().at(-1)?.params).toMatchObject({
      page: '1',
      limit: '10',
      sort: 'id',
      order: 'asc',
    });
  });

  it('Q-create-invalid: empty form shows field errors and sends nothing', async () => {
    const api = server();
    await as('editor');
    await mount();
    await click(button('Add product'));
    const dialog = openDialog();
    await click(within(dialog).getByRole('button', { name: 'Save' }));
    const expected: [string, string][] = [
      ['SKU', 'SKU is required'],
      ['Name', 'Name is required'],
      ['Price', 'Price must be a number with up to 2 decimals'],
      ['Stock', 'Stock must be a whole number ≥ 0'],
    ];
    for (const [label, message] of expected) {
      expect(describedText(within(dialog).getByLabelText(label)), label).toContain(message);
    }
    expect(api.writes()).toEqual([]);
    expect(openDialog()).toBe(dialog);
  });

  it('Q-create-409: conflict keeps the dialog open with the input intact', async () => {
    server(makeProducts(30), (req) =>
      req.method === 'POST' ? json(409, { error: 'conflict' }) : undefined,
    );
    await as('editor');
    await mount();
    await click(button('Add product'));
    const dialog = openDialog();
    await fill(dialog, values);
    await click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(openDialog()).getByRole('alert').textContent).toContain('SKU already exists');
    for (const [label, value] of Object.entries(values)) {
      expect((within(dialog).getByLabelText(label) as HTMLInputElement).value, label).toBe(value);
    }
  });

  it('Q-create-error: any other error shows Could not save product', async () => {
    server(makeProducts(30), (req) =>
      req.method === 'POST' ? json(500, { error: 'internal' }) : undefined,
    );
    await as('admin');
    await mount();
    await click(button('Add product'));
    const dialog = openDialog();
    await fill(dialog, values);
    await click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(openDialog()).getByRole('alert').textContent).toContain('Could not save product');
  });

  it('Q-edit: prefilled dialog, Save sends PATCH /api/products/1', async () => {
    const api = server();
    await as('editor');
    await mount();
    await click(button('Edit SKU-0001'));
    const dialog = openDialog();
    expect(within(dialog).getByRole('heading', { name: 'Edit product' })).toBeTruthy();
    const input = (label: string) => within(dialog).getByLabelText(label) as HTMLInputElement;
    expect([
      input('SKU').value,
      input('Name').value,
      input('Price').value,
      input('Stock').value,
    ]).toEqual(['SKU-0001', 'Product 1', '12.34', '1']);
    await type(input('Name'), 'Renamed');
    await click(within(dialog).getByRole('button', { name: 'Save' }));
    const [patch] = api.writes();
    expect(patch).toMatchObject({ method: 'PATCH', path: '/api/products/1' });
    expect(patch?.body).toMatchObject({ name: 'Renamed' });
    expect(document.querySelector('dialog[open]')).toBeNull();
  });

  it('Q-delete: confirm text, DELETE and reload; 409 shows the orders alert', async () => {
    let conflict = false;
    const api = server(makeProducts(30), (req) =>
      req.method === 'DELETE' && conflict ? json(409, { error: 'conflict' }) : undefined,
    );
    await as('editor');
    await mount();
    await click(button('Delete SKU-0001'));
    let dialog = openDialog();
    expect(dialog.textContent).toContain('Delete Product 1?');
    const listsBefore = api.lists().length;
    await click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(api.writes()).toEqual([
      expect.objectContaining({ method: 'DELETE', path: '/api/products/1' }),
    ]);
    expect(api.lists().length).toBeGreaterThan(listsBefore);
    expect(screen.queryByRole('button', { name: 'Delete SKU-0001' })).toBeNull();

    conflict = true;
    await click(button('Delete SKU-0002'));
    dialog = openDialog();
    await click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('alert').textContent).toContain('Cannot delete: product has orders');
  });

  it('Q-delete-last-page: deleting the only item on the last page steps back a page', async () => {
    const api = server(makeProducts(21));
    await as('editor');
    await mount();
    await click(button('Next'));
    await click(button('Next'));
    expect(screen.getByText('Page 3 of 3')).toBeTruthy();
    expect(rows()).toHaveLength(1);
    await click(button('Delete SKU-0021'));
    await click(within(openDialog()).getByRole('button', { name: 'Delete' }));
    await flush(0);
    expect(api.lists().at(-1)?.params).toMatchObject({ page: '2' });
    expect(screen.getByText('Page 2 of 2')).toBeTruthy();
    expect(rows()).toHaveLength(10);
  });
});

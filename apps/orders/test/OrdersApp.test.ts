/** @vitest-environment jsdom */
// Q-orders-unit (Vue). ASSUMPTIONS (phase 2 adapts): apps/orders/src/OrdersApp.ts exports `mount` and `buildVersion`;
// the vitest config gets the Vue plugin; listOrders (and listProducts for product names) come from @mfe/api-client and
// are mocked here; the status filter is a labelled <select>; the empty and error states use role=status / role=alert.
// The mocked rows carry both the plain API fields and product_name / total_cents, so a join in the API or a second
// listProducts call both give the same table.
import { emit } from '@mfe/events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listOrders: vi.fn(), listProducts: vi.fn() }));
vi.mock('@mfe/api-client', async (orig) => ({
  ...(await orig<typeof import('@mfe/api-client')>()),
  listOrders: api.listOrders,
  listProducts: api.listProducts,
}));

import { buildVersion, mount } from '../src/OrdersApp.ts';

const order = (id: number, status: string) => ({
  id,
  product_id: 3,
  qty: 2,
  status,
  created_at: '2026-10-05T09:30:00.000Z',
  product_name: 'Pressure sensor',
  total_cents: 3998,
});
const pageOf = (items: ReturnType<typeof order>[]) => ({
  items,
  total: items.length,
  page: 1,
  limit: 10,
});
const products = {
  items: [
    {
      id: 3,
      sku: 'PS-1',
      name: 'Pressure sensor',
      price_cents: 1999,
      stock: 5,
      created_at: '2026-01-01',
    },
  ],
  total: 1,
  page: 1,
  limit: 100,
};
const norm = (s: string | null | undefined) => (s ?? '').replace(/[\u00a0\u202f]/g, ' ');

let host: HTMLElement;
let unmount: (() => void) | undefined;
const onError = vi.fn();
const root = () => host.shadowRoot!;
const rows = () => root().querySelectorAll('table tbody tr');
const start = (locale: 'de' | 'en' = 'en') => {
  unmount = mount(host, { locale, onError });
};
const ready = () => vi.waitFor(() => expect(rows().length).toBeGreaterThan(0));
const lastQuery = () => api.listOrders.mock.lastCall![0] as { status?: string };

beforeEach(() => {
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  api.listOrders.mockResolvedValue(pageOf([order(11, 'paid'), order(12, 'new')]));
  api.listProducts.mockResolvedValue(products);
});
afterEach(() => {
  unmount?.();
  unmount = undefined;
  host.remove();
  vi.clearAllMocks();
});

describe('orders remote (Vue)', () => {
  it('Q-orders-unit: exports a build version', () => {
    expect(typeof buildVersion).toBe('string');
    expect(buildVersion.length).toBeGreaterThan(0);
  });

  it('Q-orders-unit: mount renders the table into an open shadow root, not into the host light DOM', async () => {
    const head = document.head.innerHTML;
    const sheets = document.adoptedStyleSheets.length;
    start();
    expect(host.shadowRoot).not.toBeNull();
    expect(host.shadowRoot!.mode).toBe('open');
    await ready();
    expect(root().querySelector('table')).not.toBeNull();
    expect(host.querySelector('table')).toBeNull();
    expect(rows()).toHaveLength(2);
    // styles stay inside the shadow root
    expect(document.head.innerHTML).toBe(head);
    expect(document.adoptedStyleSheets.length).toBe(sheets);
  });

  it('Q-orders-unit: semantics, a caption, id as row header, a datetime attribute, a labelled filter', async () => {
    start();
    await ready();
    expect(root().querySelector('table caption')?.textContent?.trim()).toBeTruthy();
    expect(root().querySelectorAll('thead th[scope="col"]').length).toBeGreaterThanOrEqual(5);
    expect(rows()[0]!.querySelector('th[scope="row"]')?.textContent).toContain('11');
    expect(rows()[0]!.querySelector('time')?.getAttribute('datetime')).toMatch(/^2026-10-05/);
    const select = root().querySelector('select')!;
    const label = root().querySelector(`label[for="${select.id}"]`) ?? select.closest('label');
    expect(select.getAttribute('aria-label') ?? label?.textContent).toBeTruthy();
    expect(
      [...select.options]
        .map((o) => o.value)
        .filter(Boolean)
        .sort(),
    ).toEqual(['new', 'paid', 'shipped']);
  });

  it('Q-orders-unit: the status filter changes the listOrders query', async () => {
    start();
    await ready();
    expect(lastQuery().status).toBeUndefined();
    const select = root().querySelector('select')!;
    select.value = 'shipped';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(lastQuery().status).toBe('shipped'));
    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(lastQuery().status).toBeUndefined());
  });

  it('Q-orders-unit: English money and date', async () => {
    start('en');
    await ready();
    const text = norm(rows()[0]!.textContent);
    expect(text).toContain('€39.98');
    expect(text).toContain('05/10/2026');
    expect(text).toContain('Pressure sensor');
  });

  it('Q-orders-unit: German money and date', async () => {
    document.documentElement.lang = 'de';
    start('de');
    await ready();
    const text = norm(rows()[0]!.textContent);
    expect(text).toContain('39,98 €');
    expect(text).toContain('05.10.2026');
  });

  it('Q-orders-unit: locale:changed relabels in place, the table element is kept', async () => {
    start('en');
    await ready();
    const table = root().querySelector('table');
    const before = norm(rows()[0]!.textContent);
    document.documentElement.lang = 'de';
    emit('locale:changed', { locale: 'de' });
    await vi.waitFor(() => expect(norm(rows()[0]!.textContent)).toContain('39,98 €'));
    expect(norm(rows()[0]!.textContent)).not.toBe(before);
    expect(root().querySelector('table')).toBe(table);
  });

  it('Q-orders-unit: an empty page shows an empty state and no rows', async () => {
    api.listOrders.mockResolvedValue(pageOf([]));
    start();
    await vi.waitFor(() => expect(root().textContent).toMatch(/no orders/i));
    expect(rows().length === 0 || root().querySelector('[role="status"]') !== null).toBe(true);
  });

  it('Q-orders-unit: a failing request shows an alert', async () => {
    api.listOrders.mockRejectedValue(new Error('boom'));
    start();
    await vi.waitFor(() => expect(root().querySelector('[role="alert"]')).not.toBeNull());
    expect(rows()).toHaveLength(0);
  });

  it('Q-orders-unit: products:changed refetches', async () => {
    start();
    await ready();
    const calls = api.listOrders.mock.calls.length;
    emit('products:changed', { id: 3, kind: 'updated' });
    await vi.waitFor(() => expect(api.listOrders.mock.calls.length).toBeGreaterThan(calls));
  });

  it('Q-orders-unit: unmount removes the app and stops listening', async () => {
    start();
    await ready();
    unmount!();
    unmount = undefined;
    expect(root()?.querySelector('table') ?? null).toBeNull();
    expect(root()?.childElementCount ?? 0).toBe(0);
    const calls = api.listOrders.mock.calls.length;
    emit('products:changed', { id: 3, kind: 'updated' });
    await new Promise((r) => setTimeout(r, 50));
    expect(api.listOrders.mock.calls.length).toBe(calls);
  });
});

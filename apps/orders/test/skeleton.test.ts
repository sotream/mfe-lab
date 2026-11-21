/** @vitest-environment jsdom */
// Q-surfaces (orders, Vue). ASSUMPTIONS: skeleton rows are `tbody tr[aria-hidden="true"]` inside the shadow root,
// styled with the `orders-skeleton` class; the table is aria-busy; the status filter is a real, labelled combobox.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listOrders: vi.fn(), listProducts: vi.fn() }));
vi.mock('@mfe/api-client', async (orig) => ({
  ...(await orig<typeof import('@mfe/api-client')>()),
  listOrders: api.listOrders,
  listProducts: api.listProducts,
}));

import { mount } from '../src/OrdersApp.ts';

let host: HTMLElement;
let unmount: (() => void) | undefined;

beforeEach(() => {
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  api.listOrders.mockReturnValue(new Promise(() => {}));
  api.listProducts.mockReturnValue(new Promise(() => {}));
});
afterEach(() => {
  unmount?.();
  unmount = undefined;
  host.remove();
  vi.clearAllMocks();
});

describe('orders loading state', () => {
  it('Q-surfaces: pending shows skeleton rows in the shadow root, the real filter and a status text', async () => {
    unmount = mount(host, { locale: 'en', onError: vi.fn() });
    const root = host.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector('table')).not.toBeNull());
    const table = root.querySelector('table')!;
    expect(table.getAttribute('aria-busy')).toBe('true');
    const rows = table.querySelectorAll('tbody tr[aria-hidden="true"]');
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(table.querySelectorAll('tbody tr')).toHaveLength(rows.length);
    expect(table.querySelector('.orders-skeleton')).not.toBeNull();
    expect(table.querySelector('caption')).not.toBeNull();
    expect(root.querySelector('[role="combobox"]')).not.toBeNull();
    expect(root.querySelector('[role="status"]')?.textContent).toContain('Loading orders');
  });
});

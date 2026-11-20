/** @vitest-environment jsdom */
import type { Stats } from '@mfe/api-client';
import { login, logout } from '@mfe/auth-store';
import { emit } from '@mfe/events';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from '../src/DashboardPage.tsx';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const stats = (products: number): Stats => ({
  counts: { products, orders: 60 },
  revenue_by_status: { new: 1, paid: 2, shipped: 3 },
  orders_per_day: [{ date: '2026-10-01', count: 2 }],
});

// Each /api/stats call answers with the next value of `products`.
const server = (values: number[]) => {
  const fetch = vi.fn(async (url: string) =>
    url === '/api/auth/login'
      ? json(200, { token: 't', user: { id: 3, email: 'viewer@lab.test', role: 'viewer' } })
      : url === '/api/flags'
        ? json(404, { error: 'not_found' })
        : json(200, stats(values.shift() ?? 0)),
  );
  vi.stubGlobal('fetch', fetch);
  return () => fetch.mock.calls.filter(([u]) => u === '/api/stats').length;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mount = async () => {
  await act(() => login('viewer@lab.test', 'lab12345'));
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    await sleep(20);
  });
  return view;
};
const tile = (label: string) =>
  Array.from(document.querySelectorAll('dl dt'))
    .find((dt) => (dt.textContent ?? '').trim() === label)
    ?.nextElementSibling?.textContent?.trim();

afterEach(() => {
  cleanup();
  logout();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DashboardPage events', () => {
  it('Q-dash-invalidate: products:changed refetches stats and updates the tile', async () => {
    const calls = server([30, 31]);
    await mount();
    expect(calls()).toBe(1);
    expect(tile('Products')).toBe('30');
    await act(async () => {
      emit('products:changed', { id: 1, kind: 'created' });
      await sleep(20);
    });
    expect(calls()).toBe(2);
    expect(tile('Products')).toBe('31');
  });

  it('Q-dash-unsub: after unmount an emit causes no fetch and no React warning', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls = server([30, 31]);
    const view = await mount();
    expect(calls()).toBe(1);
    await act(async () => view.unmount());
    await act(async () => {
      emit('products:changed', { id: 1, kind: 'deleted' });
      await sleep(20);
    });
    expect(calls()).toBe(1);
    expect(errors).not.toHaveBeenCalled();
  });
});

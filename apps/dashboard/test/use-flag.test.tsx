/** @vitest-environment jsdom */
import type { Stats } from '@mfe/api-client';
import { login, logout } from '@mfe/auth-store';
import { emit } from '@mfe/events';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from '../src/DashboardPage.tsx';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const stats: Stats = {
  counts: { products: 30, orders: 60 },
  revenue_by_status: { new: 1, paid: 2, shipped: 3 },
  orders_per_day: [{ date: '2026-10-01', count: 2 }],
};

// `flags`: current answer for GET /api/flags; null = 404.
const server = (flags: { value: boolean | null }) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/auth/login')
        return json(200, { token: 't', user: { id: 3, email: 'viewer@lab.test', role: 'viewer' } });
      if (url === '/api/flags')
        return flags.value === null
          ? json(404, { error: 'not_found' })
          : json(200, [
              { name: 'dashboard.revenue', enabled: flags.value, description: 'Revenue' },
            ]);
      return json(200, stats);
    }),
  );

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mount = async () => {
  await act(() => login('viewer@lab.test', 'lab12345'));
  await act(async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    await sleep(50);
  });
};
const revenue = () => screen.queryByRole('heading', { name: 'Revenue by status' });

afterEach(() => {
  cleanup();
  logout();
  vi.unstubAllGlobals();
});

describe('dashboard useFlag', () => {
  it('Q-use-flag: flag off hides Revenue; flags:changed after flip to true brings it back', async () => {
    const flags = { value: false as boolean | null };
    server(flags);
    await mount();
    expect(revenue()).toBeNull();
    flags.value = true;
    await act(async () => {
      emit('flags:changed', { name: 'dashboard.revenue', enabled: true });
      await sleep(50);
    });
    expect(revenue()).not.toBeNull();
  });

  it('Q-use-flag: /flags 404 falls back to showing Revenue', async () => {
    server({ value: null });
    await mount();
    expect(revenue()).not.toBeNull();
  });
});

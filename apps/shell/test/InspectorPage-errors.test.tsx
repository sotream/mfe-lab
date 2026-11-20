/** @vitest-environment jsdom */
import { login, logout } from '@mfe/auth-store';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@module-federation/enhanced/runtime', () => ({
  getInstance: () => null,
  init: vi.fn(),
  registerRemotes: vi.fn(),
  loadRemote: vi.fn(),
}));

import InspectorPage from '../src/InspectorPage.tsx';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const row = (id: number, remote: string, kind: string, message: string) => ({
  id,
  remote,
  build: `build-${id}`,
  kind,
  message,
  stack: null,
  url: 'http://localhost:3000/',
  at: '2026-11-20T10:00:00.000Z',
});

let rows: ReturnType<typeof row>[] = [];
const server = () => {
  rows = [
    row(3, 'products', 'render', 'kaboom one'),
    row(2, 'dashboard', 'load', 'chunk failed'),
    row(1, 'products', 'render', 'kaboom two'),
  ];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/auth/login') {
      const email = JSON.parse(String(init?.body)).email as string;
      return json(200, { token: 't', user: { id: 1, email, role: email.split('@')[0] } });
    }
    if (url === '/api/flags') return json(200, []);
    if (url.startsWith('/api/errors/summary')) {
      const by = new Map<string, number>();
      for (const r of rows) by.set(r.remote, (by.get(r.remote) ?? 0) + 1);
      return json(
        200,
        [...by].map(([remote, count]) => ({ remote, count })),
      );
    }
    if (url.startsWith('/api/errors') && method === 'DELETE') {
      rows = [];
      return new Response(null, { status: 204 });
    }
    if (url.startsWith('/api/errors') && method === 'GET') return json(200, rows);
    return new Response('no', { status: 500 });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
};

const mount = async (as?: string) => {
  if (as) await act(() => login(`${as}@lab.test`, 'lab12345'));
  await act(async () => {
    render(<InspectorPage />);
    await new Promise((r) => setTimeout(r, 30));
  });
};
const errorsTable = () =>
  screen
    .getAllByRole('table')
    .find((t) => within(t).queryByRole('columnheader', { name: 'Kind' })) as HTMLElement;

beforeEach(() => void server());
afterEach(() => {
  cleanup();
  logout();
  vi.unstubAllGlobals();
});

describe('InspectorPage errors', () => {
  it('Q-inspector-errors: admin sees summary counts and rows', async () => {
    await mount('admin');
    expect(screen.getByRole('heading', { level: 2, name: 'Errors' })).toBeTruthy();
    expect(screen.getByText('products: 2')).toBeTruthy();
    expect(screen.getByText('dashboard: 1')).toBeTruthy();
    const table = errorsTable();
    for (const h of ['Time', 'Remote', 'Build', 'Kind', 'Message'])
      expect(within(table).getByRole('columnheader', { name: h })).toBeTruthy();
    expect(within(table).getByText('kaboom one')).toBeTruthy();
    expect(within(table).getByText('chunk failed')).toBeTruthy();
    expect(within(table).getByText('build-3')).toBeTruthy();
    expect(within(table).getAllByRole('row')).toHaveLength(4); // header + 3
  });

  it('Q-inspector-errors: Refresh re-fetches', async () => {
    await mount('admin');
    rows.unshift(row(4, 'dashboard', 'unhandled', 'fresh one'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(within(errorsTable()).getByText('fresh one')).toBeTruthy();
  });

  it('Q-inspector-errors: Clear sends DELETE and empties the table', async () => {
    await mount('admin');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
      await new Promise((r) => setTimeout(r, 30));
    });
    const del = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([, init]) => init?.method === 'DELETE');
    expect(String(del?.[0]).startsWith('/api/errors')).toBe(true);
    expect(screen.queryByText('kaboom one')).toBeNull();
    expect(screen.queryByText('products: 2')).toBeNull();
  });

  it('Q-inspector-errors: a viewer sees Admins only and no errors request', async () => {
    await mount('viewer');
    expect(screen.getByRole('heading', { level: 2, name: 'Errors' })).toBeTruthy();
    expect(screen.getByText('Admins only')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    expect(screen.queryByText('kaboom one')).toBeNull();
  });
});

/** @vitest-environment jsdom */
import { login, logout } from '@mfe/auth-store';
import { onAny } from '@mfe/events';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
const flags = [
  { name: 'dashboard.revenue', enabled: true, description: 'Revenue' },
  { name: 'products.crash', enabled: false, description: 'Crash demo' },
];
const errorRow = {
  id: 1,
  remote: 'products',
  build: 'b1',
  kind: 'render',
  message: 'kaboom',
  stack: null,
  url: 'http://localhost:3000/',
  at: '2026-11-20T10:00:00.000Z',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const announced: string[] = [];
let off: () => void;

beforeEach(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/auth/login') {
        const email = JSON.parse(String(init?.body)).email as string;
        return json(200, { token: 't', user: { id: 1, email, role: 'admin' } });
      }
      if (url === '/api/flags' && method === 'GET') return json(200, flags);
      if (url.startsWith('/api/flags/') && method === 'PATCH') {
        const body = JSON.parse(String(init?.body));
        const name = decodeURIComponent(url.slice('/api/flags/'.length));
        return json(200, { ...flags.find((f) => f.name === name), enabled: body.enabled });
      }
      if (url.startsWith('/api/errors/summary'))
        return json(200, [{ remote: 'products', count: 1 }]);
      if (url.startsWith('/api/errors') && method === 'DELETE')
        return new Response(null, { status: 204 });
      if (url.startsWith('/api/errors')) return json(200, [errorRow]);
      return new Response('no', { status: 500 });
    }),
  );
  await act(() => login('admin@lab.test', 'lab12345'));
  await act(async () => {
    render(<InspectorPage />);
    await sleep(30);
  });
  announced.length = 0;
  off = onAny((e) => {
    if (e.name === 'a11y:announce') announced.push((e.detail as { message: string }).message);
  });
});
afterEach(() => {
  off?.();
  cleanup();
  logout();
  vi.unstubAllGlobals();
});

const click = (el: HTMLElement) =>
  act(async () => {
    fireEvent.click(el);
    await sleep(30);
  });

describe('InspectorPage announcements', () => {
  it('Q-announce: a flag toggle announces "<flag> turned on/off"', async () => {
    await click(screen.getByRole('checkbox', { name: 'products.crash' }));
    expect(announced).toEqual(['products.crash turned on']);
    announced.length = 0;
    await click(screen.getByRole('checkbox', { name: 'dashboard.revenue' }));
    expect(announced).toEqual(['dashboard.revenue turned off']);
  });

  it('Q-announce: Clear errors announces "Errors cleared"', async () => {
    await click(screen.getByRole('button', { name: 'Clear' }));
    expect(announced).toEqual(['Errors cleared']);
  });
});

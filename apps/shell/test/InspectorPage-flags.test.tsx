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

import { onAny } from '@mfe/events';
import InspectorPage from '../src/InspectorPage.tsx';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const flags = [
  { name: 'dashboard.revenue', enabled: true, description: 'Show the Revenue by status section' },
  { name: 'products.crash', enabled: false, description: 'Crash demo' },
  { name: 'products.detailPage', enabled: true, description: 'Link names' },
];

const server = () => {
  const patches: { url: string; body: unknown }[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/login') {
      const email = JSON.parse(String(init?.body)).email as string;
      return json(200, { token: 't', user: { id: 1, email, role: email.split('@')[0] } });
    }
    if (url === '/api/flags' && (init?.method ?? 'GET') === 'GET') return json(200, flags);
    if (url.startsWith('/api/flags/') && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body));
      patches.push({ url, body });
      const name = decodeURIComponent(url.slice('/api/flags/'.length));
      return json(200, { ...flags.find((f) => f.name === name), enabled: body.enabled });
    }
    return new Response('no', { status: 500 });
  });
  vi.stubGlobal('fetch', fetch);
  return patches;
};

const mount = async (as?: string) => {
  if (as) await act(() => login(`${as}@lab.test`, 'lab12345'));
  await act(async () => {
    render(<InspectorPage />);
    await new Promise((r) => setTimeout(r, 30));
  });
};
const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;

beforeEach(() => void server());
afterEach(() => {
  cleanup();
  logout();
  vi.unstubAllGlobals();
});

describe('InspectorPage flags', () => {
  it('Q-inspector-flags: heading and columns', async () => {
    await mount('viewer');
    expect(screen.getByRole('heading', { level: 2, name: 'Flags' })).toBeTruthy();
    const table = screen
      .getAllByRole('table')
      .find((t) => within(t).queryByRole('columnheader', { name: 'Flag' })) as HTMLElement;
    for (const h of ['Flag', 'Enabled', 'Description'])
      expect(within(table).getByRole('columnheader', { name: h })).toBeTruthy();
    expect(within(table).getByText('dashboard.revenue')).toBeTruthy();
  });

  it('Q-inspector-flags: admin click PATCHes, emits flags:changed, updates the row', async () => {
    const seen: { name: string; detail: unknown }[] = [];
    const off = onAny((e) => void seen.push({ name: e.name, detail: e.detail }));
    await mount('admin');
    expect(box('dashboard.revenue').disabled).toBe(false);
    expect(box('dashboard.revenue').checked).toBe(true);
    expect(box('products.crash').checked).toBe(false);

    await act(async () => {
      fireEvent.click(box('dashboard.revenue'));
      await new Promise((r) => setTimeout(r, 30));
    });
    off();

    const fetch = vi.mocked(globalThis.fetch);
    const patch = fetch.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(patch?.[0]).toBe('/api/flags/dashboard.revenue');
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ enabled: false });
    expect(seen).toContainEqual({
      name: 'flags:changed',
      detail: { name: 'dashboard.revenue', enabled: false },
    });
    expect(box('dashboard.revenue').checked).toBe(false);
  });

  it('Q-inspector-flags: viewer sees disabled checkboxes', async () => {
    await mount('viewer');
    for (const f of flags) expect(box(f.name).disabled).toBe(true);
  });

  it('Q-inspector-flags: signed out shows a sign-in hint', async () => {
    await mount();
    expect(screen.getByText('Sign in to see flags')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});

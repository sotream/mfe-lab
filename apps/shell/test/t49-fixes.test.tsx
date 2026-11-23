/** @vitest-environment jsdom */
// T49: Q-inspector-no-ping-off, Q-de-strings (shell), E-a11y HintTh: off chip, dev option labels in EN/DE, hint header tooltip.
import { login, logout } from '@mfe/auth-store';
import { emit } from '@mfe/events';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@module-federation/enhanced/runtime', () => ({
  getInstance: () => null,
  registerPlugins: vi.fn(),
  init: vi.fn(),
  registerRemotes: vi.fn(),
  loadRemote: vi.fn(() => Promise.resolve({ default: () => null, buildVersion: 'test' })),
}));

import InspectorPage from '../src/InspectorPage.tsx';
import { applyRegistryRow } from '../src/remotes.ts';

const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
proto.showPopover ??= vi.fn();
proto.hidePopover ??= vi.fn();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const flags = [
  { name: 'dashboard.revenue', enabled: true, description: 'Show the Revenue by status section' },
  { name: 'products.crash', enabled: false, description: 'Crash the products page' },
  { name: 'products.detailPage', enabled: true, description: 'Link product names to details' },
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
const row = (name: string, disabled = false) => ({
  name,
  canaryUrl: null,
  canaryPercent: 0,
  disabled,
});
let fetchMock: ReturnType<typeof vi.fn>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = 'en';
  for (const n of ['products', 'dashboard', 'orders']) applyRegistryRow(row(n));
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/auth/login') {
      const email = JSON.parse(String(init?.body)).email as string;
      return json(200, { token: 't', user: { id: 1, email, role: 'admin' } });
    }
    if (url === '/api/flags') return json(200, flags);
    if (url.startsWith('/api/errors/summary')) return json(200, [{ remote: 'products', count: 1 }]);
    if (url.startsWith('/api/errors') && method === 'GET') return json(200, [errorRow]);
    if (String(url).endsWith('/releases/index.json')) return json(200, { versions: ['1.0.0'] });
    return json(200, { metaData: { buildInfo: { buildVersion: 'x' } } });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  logout();
  localStorage.clear();
  document.documentElement.lang = 'en';
  vi.unstubAllGlobals();
});

const mount = async (as?: string) => {
  if (as) await act(() => login(`${as}@lab.test`, 'lab12345'));
  await act(async () => {
    render(<InspectorPage />);
    await sleep(30);
  });
};
const setLocale = (locale: 'de' | 'en') =>
  act(async () => {
    document.documentElement.lang = locale;
    emit('locale:changed', { locale });
    await sleep(30);
  });
const rowOf = (name: string) =>
  within(screen.getByRole('table', { name: 'Remotes' }))
    .getByRole('rowheader', { name: new RegExp(name) })
    .closest('tr') as HTMLElement;

describe('Q-inspector-no-ping-off', () => {
  it('a remote the registry switched off is not fetched, its status reads off', async () => {
    applyRegistryRow(row('products', true));
    await mount();
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes(':3001/') && u.includes('mf-manifest'))).toEqual([]);
    expect(urls.some((u) => u.includes(':3002/'))).toBe(true); // the others are still pinged
    expect(
      within(rowOf('products').querySelector('th') as HTMLElement).getByText('off'),
    ).toBeTruthy();
  });
});

describe('Q-de-strings (inspector)', () => {
  it('flag descriptions are German in DE and unchanged in EN', async () => {
    await mount('admin');
    const cellText = () =>
      within(screen.getByRole('table', { name: /^(Flags)$/ }))
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.textContent ?? '');
    for (const f of flags) expect(cellText().join('|')).toContain(f.description);
    await setLocale('de');
    const de = cellText().join('|');
    for (const f of flags) expect(de, f.name).not.toContain(f.description);
    for (const f of flags) expect(de).toContain(f.name); // names stay
  });

  it('the error kind chip is German in DE', async () => {
    await mount('admin');
    await setLocale('de');
    const table = screen.getByRole('table', { name: /Fehler/ });
    const cells = within(table).getAllByRole('row')[1]!.textContent ?? '';
    expect(cells).toContain('kaboom');
    const kind = within(table).getAllByRole('row')[1]!.querySelector('.chip')?.textContent;
    expect(kind).toBeTruthy();
    expect(kind).not.toBe('render');
  });

  it('the empty option reads "default (registry)" in EN and "Standard (Registry)" in DE', async () => {
    await mount();
    const labels = async () => {
      const s = screen.getByRole('combobox', { name: /^products/ });
      await act(async () => void fireEvent.click(s));
      const out = document
        .getElementById(s.getAttribute('aria-controls')!)!
        .querySelectorAll<HTMLElement>('[role="option"]');
      const text = [...out].map((o) => o.textContent?.trim());
      await act(async () => void fireEvent.keyDown(s, { key: 'Escape' }));
      return text;
    };
    expect(await labels()).toContain('default (registry)');
    expect(await labels()).not.toContain('dev (local)');
    await setLocale('de');
    expect(await labels()).toContain('Standard (Registry)');
    expect(await labels()).not.toContain('dev (lokal)');
  });
});

describe('E-a11y HintTh', () => {
  it('the hint text is announced once: the label and the description are not the same text', async () => {
    await mount();
    const heads = document.querySelectorAll('th.hint-th');
    expect(heads.length).toBeGreaterThan(0);
    for (const th of heads) {
      const trigger = th.querySelector('[aria-label], [aria-describedby]') as HTMLElement;
      expect(trigger, th.textContent ?? '').toBeTruthy();
      // The name is the column; the hint arrives through aria-describedby. The same text must not be both.
      const described = (trigger.getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
        .trim();
      const name = trigger.getAttribute('aria-label') ?? '';
      expect(name && described && name === described, 'hint read twice').toBe(false);
    }
  });
});

describe('Q-de-strings (footer)', () => {
  it('the footer build prefix is "Build" in DE and "build" in EN', async () => {
    window.history.pushState({}, '', '/');
    const { router } = await import('../src/App.tsx');
    await act(async () => {
      await router.navigate('/');
      render(<RouterProvider router={router} />);
      await sleep(30);
    });
    const footer = () => document.querySelector('footer .build')?.textContent ?? '';
    expect(footer()).toMatch(/^build /);
    await setLocale('de');
    expect(footer()).toMatch(/^Build /);
  });
});

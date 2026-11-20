/** @vitest-environment jsdom */
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rt = vi.hoisted(() => ({ instance: null as unknown }));
vi.mock('@module-federation/enhanced/runtime', () => ({
  getInstance: () => rt.instance,
  registerRemotes: vi.fn(),
  loadRemote: vi.fn(),
}));

import InspectorPage from '../src/InspectorPage.tsx';

const PRODUCTS = 'http://localhost:3001/mf-manifest.json';
const DASHBOARD = 'http://localhost:3002/mf-manifest.json';
const manifest = (v: string) =>
  new Response(JSON.stringify({ metaData: { buildInfo: { buildVersion: v } } }), { status: 200 });

type Handler = (url: string) => Response | Promise<Response>;
const stubFetch = (handler: Handler) => {
  const fetch = vi.fn((url: string) => Promise.resolve(handler(String(url))));
  vi.stubGlobal('fetch', fetch);
  return fetch;
};
const callsTo = (fetch: ReturnType<typeof stubFetch>, url: string) =>
  fetch.mock.calls.filter(([u]) => String(u) === url).length;
const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const mount = () => act(async () => void render(<InspectorPage />));
const rowFor = (cell: string) => screen.getByText(cell).closest('tr') as HTMLElement;
const remotesTable = () => screen.getAllByRole('table')[0] as HTMLElement;
const sharedTable = () => screen.getAllByRole('table')[1] as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  rt.instance = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('InspectorPage', () => {
  it('Q-inspector-remotes: rows, manifest URLs, checking… then up/down with version or dash', async () => {
    stubFetch((url) => (url === PRODUCTS ? manifest('p-1') : new Response('no', { status: 500 })));
    render(<InspectorPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Federation inspector' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Remotes' })).toBeTruthy();
    for (const h of ['Name', 'Manifest', 'Version', 'Status']) {
      expect(within(remotesTable()).getByRole('columnheader', { name: h })).toBeTruthy();
    }
    const initial = within(remotesTable()).getAllByRole('row').slice(1);
    expect(initial.map((r) => within(r).getByRole('rowheader').textContent)).toEqual([
      'products',
      'dashboard',
    ]);
    expect(within(rowFor(PRODUCTS)).getByText('checking…')).toBeTruthy();
    expect(within(rowFor(DASHBOARD)).getByText('checking…')).toBeTruthy();

    await tick(0);
    const p = within(rowFor(PRODUCTS));
    expect(p.getByText('up')).toBeTruthy();
    expect(p.getByText('p-1')).toBeTruthy();
    const d = within(rowFor(DASHBOARD));
    expect(d.getByText('down')).toBeTruthy();
    expect(d.getByText('—')).toBeTruthy();
    expect(screen.queryByText('checking…')).toBeNull();
  });

  it('Q-inspector-poll: refetches every 5000 ms, updates rows, stops after unmount', async () => {
    let dashboardUp = false;
    const fetch = stubFetch((url) =>
      url === DASHBOARD && !dashboardUp ? new Response('x', { status: 500 }) : manifest('v'),
    );
    const { unmount } = await act(async () => render(<InspectorPage />));
    await tick(0);
    expect(callsTo(fetch, PRODUCTS)).toBe(1);
    expect(callsTo(fetch, DASHBOARD)).toBe(1);
    expect(within(rowFor(DASHBOARD)).getByText('down')).toBeTruthy();

    dashboardUp = true;
    await tick(5000);
    expect(callsTo(fetch, PRODUCTS)).toBe(2);
    expect(callsTo(fetch, DASHBOARD)).toBe(2);
    expect(within(rowFor(DASHBOARD)).getByText('up')).toBeTruthy();

    unmount();
    const before = fetch.mock.calls.length;
    await act(async () => void (await vi.advanceTimersByTimeAsync(20000)));
    expect(fetch.mock.calls.length).toBe(before);
  });

  it('Q-inspector-shared: table cells from the share scope map', async () => {
    stubFetch(() => manifest('v'));
    rt.instance = {
      shareScopeMap: {
        default: {
          react: {
            '19.1.0': {
              from: 'shell',
              loaded: true,
              shareConfig: { singleton: true, requiredVersion: '^19.0.0' },
            },
          },
          lodash: { '4.0.0': { from: 'shell', shareConfig: { requiredVersion: false } } },
        },
      },
    };
    await mount();
    expect(screen.getByRole('heading', { level: 2, name: 'Shared dependencies' })).toBeTruthy();
    for (const h of ['Package', 'Required', 'Loaded', 'Singleton', 'Status']) {
      expect(within(sharedTable()).getByRole('columnheader', { name: h })).toBeTruthy();
    }
    const cells = (name: string) => {
      const row = within(within(sharedTable()).getByText(name).closest('tr') as HTMLElement);
      return [
        row.getByRole('rowheader').textContent,
        ...row.getAllByRole('cell').map((c) => c.textContent),
      ];
    };
    expect(cells('react')).toEqual(['react', '^19.0.0', '19.1.0', 'yes', 'loaded once']);
    expect(cells('lodash')).toEqual(['lodash', '—', '—', 'no', 'not loaded']);
  });

  it('Q-inspector-singleton: Singleton cell reads yes for singleton 1 and no for singleton false', async () => {
    stubFetch(() => manifest('v'));
    rt.instance = {
      shareScopeMap: {
        default: {
          react: {
            '19.1.0': { from: 'shell', shareConfig: { singleton: 1, requiredVersion: '^19.0.0' } },
          },
          '@mfe/ui': {
            '1.0.0': {
              from: 'products',
              shareConfig: { singleton: false, requiredVersion: '^1.0.0' },
            },
          },
        },
      },
    };
    await mount();
    const col = within(sharedTable())
      .getAllByRole('columnheader')
      .findIndex((h) => h.textContent === 'Singleton');
    expect(col).toBeGreaterThanOrEqual(0);
    // the Package column is now the row header, so body cells start one column later
    const cell = (name: string) =>
      within(within(sharedTable()).getByText(name).closest('tr') as HTMLElement).getAllByRole(
        'cell',
      )[col - 1]?.textContent;
    expect(cell('react')).toBe('yes');
    expect(cell('@mfe/ui')).toBe('no');
  });

  it('Q-inspector-shared: getInstance() null shows the empty message and does not crash', async () => {
    stubFetch(() => manifest('v'));
    rt.instance = null;
    await mount();
    expect(within(sharedTable()).getByText('No shared modules registered yet')).toBeTruthy();
  });

  it('Q-table-caption and Q-row-headers: Remotes and Shared are named, with row headers and col scopes', async () => {
    stubFetch(() => manifest('v'));
    rt.instance = {
      shareScopeMap: {
        default: { react: { '19.1.0': { from: 'shell', shareConfig: { singleton: true } } } },
      },
    };
    await mount();
    const remotes = screen.getByRole('table', { name: 'Remotes' });
    const shared = screen.getByRole('table', { name: 'Shared dependencies' });
    expect(
      within(remotes)
        .getAllByRole('rowheader')
        .map((h) => h.textContent),
    ).toEqual(['products', 'dashboard']);
    expect(
      within(shared)
        .getAllByRole('rowheader')
        .map((h) => h.textContent),
    ).toEqual(['react']);
    for (const t of [remotes, shared])
      for (const th of within(t).getAllByRole('columnheader'))
        expect(th.getAttribute('scope')).toBe('col');
  });

  it('Q-inspector-hints: "How to break this" is followed by an ol with at least 3 items', async () => {
    stubFetch(() => manifest('v'));
    await mount();
    const h = screen.getByRole('heading', { level: 2, name: 'How to break this' });
    const list = (h.parentElement as HTMLElement).querySelector('ol') ?? h.nextElementSibling;
    expect(list?.tagName).toBe('OL');
    expect(list?.querySelectorAll('li').length).toBeGreaterThanOrEqual(3);
  });
});

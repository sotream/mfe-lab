/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rt = vi.hoisted(() => ({ registerRemotes: vi.fn(), loadRemote: vi.fn(), init: vi.fn() }));
vi.mock('@module-federation/enhanced/runtime', () => ({
  getInstance: () => null,
  registerPlugins: vi.fn(),
  init: rt.init,
  registerRemotes: rt.registerRemotes,
  loadRemote: rt.loadRemote,
}));

import InspectorPage from '../src/InspectorPage.tsx';
import { setRemoteEntry } from '../src/remotes.ts';

const PRODUCTS = 'http://localhost:3001/mf-manifest.json';
const P_INDEX = 'http://localhost:3001/releases/index.json';
const P_V1 = 'http://localhost:3001/releases/1.0.0/mf-manifest.json';
const manifest = () =>
  new Response(JSON.stringify({ metaData: { buildInfo: { buildVersion: 'x' } } }), { status: 200 });

const stubFetch = (index: () => Response | Promise<Response>) => {
  const fetch = vi.fn((url: string, _init?: RequestInit) =>
    Promise.resolve(String(url).endsWith('/releases/index.json') ? index() : manifest()),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
};
const mount = () => act(async () => void render(<InspectorPage />));
const select = (name: string) => screen.getByLabelText(`${name} version`) as HTMLSelectElement;
const optionLabels = (s: HTMLSelectElement) => Array.from(s.options).map((o) => o.textContent);
const choose = (s: HTMLSelectElement, value: string) =>
  act(async () => void fireEvent.change(s, { target: { value } }));
const productsRow = () => screen.getByText('products').closest('tr') as HTMLElement;

beforeEach(() => {
  setRemoteEntry('products', null);
  setRemoteEntry('dashboard', null);
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('InspectorPage versions', () => {
  it('Q-inspector-versions: select lists dev plus versions from index.json', async () => {
    const fetch = stubFetch(() => new Response(JSON.stringify({ versions: ['1.0.0', '1.1.0'] })));
    await mount();
    expect(
      within(screen.getAllByRole('table')[0] as HTMLElement).getByRole('columnheader', {
        name: 'Use',
      }),
    ).toBeTruthy();
    const s = select('products');
    expect(optionLabels(s)).toEqual(['dev', '1.0.0', '1.1.0']);
    expect(s.options[0]?.value).toBe('');
    expect(
      fetch.mock.calls.some(([u, init]) => String(u) === P_INDEX && init?.cache === 'no-store'),
    ).toBe(true);
  });

  it('Q-inspector-versions: failing or non-OK fetch gives dev only', async () => {
    stubFetch(() => Promise.reject(new Error('boom')) as unknown as Response);
    await mount();
    expect(optionLabels(select('products'))).toEqual(['dev']);
    cleanup();
    stubFetch(() => new Response('nope', { status: 404 }));
    await mount();
    expect(optionLabels(select('products'))).toEqual(['dev']);
    expect(optionLabels(select('dashboard'))).toEqual(['dev']);
  });

  it('Q-inspector-versions: choosing a version updates Manifest and registers; dev resets', async () => {
    stubFetch(() => new Response(JSON.stringify({ versions: ['1.0.0'] })));
    await mount();
    expect(within(productsRow()).getByText(PRODUCTS)).toBeTruthy();

    await choose(select('products'), '1.0.0');
    expect(within(productsRow()).getByText(P_V1)).toBeTruthy();
    expect(rt.registerRemotes).toHaveBeenLastCalledWith(
      [expect.objectContaining({ name: 'products', entry: P_V1 })],
      { force: true },
    );

    await choose(select('products'), '');
    expect(within(productsRow()).getByText(PRODUCTS)).toBeTruthy();
    expect(rt.registerRemotes).toHaveBeenLastCalledWith(
      [expect.objectContaining({ name: 'products', entry: PRODUCTS })],
      { force: true },
    );
  });
});

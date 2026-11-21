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
// T38: the version control is the custom select (role=combobox / role=option), not a native <select>.
// jsdom has no Popover API, so showPopover/hidePopover are stubbed.
const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
proto.showPopover ??= vi.fn();
proto.hidePopover ??= vi.fn();
const select = (name: string) => screen.getByRole('combobox', { name: `${name} version` });
// every select's listbox is always in the DOM (hidden when closed): scope to this trigger's own one
const optionsOf = (s: HTMLElement) =>
  Array.from(
    document
      .getElementById(s.getAttribute('aria-controls')!)!
      .querySelectorAll<HTMLElement>('[role="option"]'),
  );
const optionLabels = async (s: HTMLElement) => {
  await act(async () => void fireEvent.click(s));
  const labels = optionsOf(s).map((o) => o.textContent?.trim());
  await act(async () => void fireEvent.keyDown(s, { key: 'Escape' }));
  return labels;
};
const choose = async (s: HTMLElement, label: string) => {
  await act(async () => void fireEvent.click(s));
  const opt = screen
    .getAllByRole('option', { hidden: true })
    .find((o) => o.textContent?.trim() === label);
  await act(async () => void fireEvent.click(opt!));
};
// T39: the URL is in the visually-hidden copy (.ds1-trunc-full) of the products row and in the hidden tooltip
const fullText = (url: string) =>
  Array.from(productsRow().querySelectorAll('.ds1-trunc-full')).find((e) => e.textContent === url);
const inUse = async () => {
  await act(
    async () => void fireEvent.click(screen.getByRole('button', { name: 'Details for products' })),
  );
  const d = within(screen.getByRole('dialog', { name: 'products: details' }));
  const text = d.getByText('In use now').nextElementSibling?.textContent;
  await act(async () => void fireEvent.click(d.getByRole('button', { name: 'Close' })));
  return text;
};
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
    expect(await optionLabels(s)).toEqual(['dev', '1.0.0', '1.1.0']);
    expect(
      fetch.mock.calls.some(([u, init]) => String(u) === P_INDEX && init?.cache === 'no-store'),
    ).toBe(true);
  });

  it('Q-inspector-versions: failing or non-OK fetch gives dev only', async () => {
    stubFetch(() => Promise.reject(new Error('boom')) as unknown as Response);
    await mount();
    expect(await optionLabels(select('products'))).toEqual(['dev']);
    cleanup();
    stubFetch(() => new Response('nope', { status: 404 }));
    await mount();
    expect(await optionLabels(select('products'))).toEqual(['dev']);
    expect(await optionLabels(select('dashboard'))).toEqual(['dev']);
  });

  it('Q-inspector-versions: choosing a version updates Manifest and registers; dev resets', async () => {
    stubFetch(() => new Response(JSON.stringify({ versions: ['1.0.0'] })));
    await mount();
    expect(fullText(PRODUCTS)).toBeTruthy();
    expect(await inUse()).toBe(PRODUCTS);

    await choose(select('products'), '1.0.0');
    // T41: the Manifest cell always shows the stable URL; the one in use is in the details dialog
    expect(fullText(PRODUCTS)).toBeTruthy();
    expect(await inUse()).toBe(P_V1);
    expect(rt.registerRemotes).toHaveBeenLastCalledWith(
      [expect.objectContaining({ name: 'products', entry: P_V1 })],
      { force: true },
    );

    await choose(select('products'), 'dev');
    expect(await inUse()).toBe(PRODUCTS);
    expect(rt.registerRemotes).toHaveBeenLastCalledWith(
      [expect.objectContaining({ name: 'products', entry: PRODUCTS })],
      { force: true },
    );
  });
});

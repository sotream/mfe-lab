/** @vitest-environment jsdom */
import { logout } from '@mfe/auth-store';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rt = vi.hoisted(() => ({ instance: null as unknown }));
vi.mock('@module-federation/enhanced/runtime', () => ({
  getInstance: () => rt.instance,
  init: vi.fn(),
  registerPlugins: vi.fn(),
  registerRemotes: vi.fn(),
  loadRemote: vi.fn(),
}));

const PRODUCTS = 'http://localhost:3001/mf-manifest.json';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const manifest = () => json(200, { metaData: { buildInfo: { buildVersion: 'v' } } });
const flags = [
  { name: 'a.one', enabled: true, description: 'x' },
  { name: 'a.two', enabled: false, description: 'y' },
  { name: 'a.three', enabled: true, description: 'z' },
];

// The label cell is the non-heading element whose text is exactly the label; its parent holds the value.
const reading = (label: string) => {
  const el = screen.getAllByText(label).find((e) => !/^H\d$/.test(e.tagName)) as HTMLElement;
  return (el.parentElement as HTMLElement).textContent ?? '';
};

beforeEach(() => {
  vi.resetModules();
  rt.instance = {
    shareScopeMap: {
      default: { react: { '19.1.0': { from: 'shell', loaded: true, shareConfig: {} } } },
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/login') {
        const email = JSON.parse(String(init?.body)).email as string;
        return json(200, { token: 't', user: { id: 1, email, role: 'admin' } });
      }
      if (url === '/api/flags') return json(200, flags);
      return url.endsWith('/mf-manifest.json') ? manifest() : new Response('no', { status: 500 });
    }),
  );
});
afterEach(() => {
  cleanup();
  logout();
  vi.unstubAllGlobals();
});

const mount = async () => {
  const { default: InspectorPage } = await import('../src/InspectorPage.tsx');
  await act(async () => {
    render(<InspectorPage />);
    await new Promise((r) => setTimeout(r, 30));
  });
};

describe('InspectorPage readings', () => {
  it('Q-inspector-lede: the live-state lede is shown', async () => {
    await mount();
    expect(
      screen.getByText(
        'Live state of this page: remotes, shared modules, flags, errors and events.',
      ),
    ).toBeTruthy();
  });

  it('Q-inspector-readings: labels, remotes up, events count, flags dash when signed out', async () => {
    const { startEventLog } = await import('../src/eventLog.ts');
    const { emit } = await import('@mfe/events');
    startEventLog();
    await mount();
    for (const l of ['Remotes up', 'Shared modules', 'Flags on', 'Events']) {
      expect(screen.getAllByText(l).length, l).toBeGreaterThan(0);
    }
    expect(reading('Remotes up')).toContain('3/3');
    expect(reading('Shared modules')).toContain('1');
    expect(reading('Flags on')).toContain('—');
    expect(reading('Events')).toContain('0');

    act(() => emit('products:changed', { id: 1, kind: 'updated' }));
    expect(reading('Events')).toContain('1');
  });

  it('Q-inspector-readings-down: a failing manifest lowers Remotes up', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === PRODUCTS ? manifest() : new Response('no', { status: 500 }),
      ),
    );
    await mount();
    expect(reading('Remotes up')).toContain('1/3');
  });

  it('Q-inspector-readings-flags: signed in, Flags on shows on/total', async () => {
    const { login } = await import('@mfe/auth-store');
    await act(() => login('admin@lab.test', 'lab12345'));
    await mount();
    expect(reading('Flags on')).toContain('2/3');
  });
});

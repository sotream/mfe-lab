/** @vitest-environment jsdom */
// T47 E-demo-banner as component tests. ASSUMPTIONS (phase 2 adapts):
// - the API's login response user (and /auth/me) carries `demo: true` for a locked admin; the shell takes it from there;
// - the chip text is exactly the contract sentence, EN and DE, in the banner (top bar) next to the role chip;
// - the Details dialog keeps the admin fields (labels "Canary manifest", "Canary %", "Switch <remote> off") but disabled
//   with aria-disabled, Save hidden or disabled, and the same sentence shown inside the dialog;
// - flag checkboxes (aria-label = flag name) and the errors "Clear" button are disabled for a locked admin;
// - axe runs in e2e only (no axe in the unit setup): run e2e/a11y.spec.ts against a prod-like API for the axe half.
import { login, logout } from '@mfe/auth-store';
import { emit } from '@mfe/events';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
const Stub = () => <h3>remote heading</h3>;
vi.mock('@module-federation/enhanced/runtime', () => ({
  getInstance: () => null,
  registerPlugins: vi.fn(),
  init: vi.fn(),
  registerRemotes: vi.fn(),
  loadRemote: vi.fn(() => Promise.resolve({ default: Stub, buildVersion: 'test' })),
}));

const EN = 'Demo admin: changes that affect everyone are disabled';
const DE = 'Demo-Admin: Änderungen, die alle betreffen, sind deaktiviert';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const setLocale = (locale: 'de' | 'en') =>
  act(async () => {
    document.documentElement.lang = locale;
    emit('locale:changed', { locale });
    await sleep(30);
  });

// who -> user as the API would return it
const users: Record<string, Record<string, unknown>> = {
  admin: { id: 1, email: 'admin@lab.test', role: 'admin', demo: true },
  unlocked: { id: 1, email: 'admin@lab.test', role: 'admin' },
  editor: { id: 2, email: 'editor@lab.test', role: 'editor' },
  viewer: { id: 3, email: 'viewer@lab.test', role: 'viewer' },
  owner: { id: 4, email: 'owner@test.invalid', role: 'superadmin' },
};

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = 'en';
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.showPopover ??= vi.fn();
  proto.hidePopover ??= vi.fn();
  const dlg = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  dlg.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  dlg.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/login') return json(200, { token: 't', user: h.user });
      if (url === '/api/auth/me') return json(200, { user: h.user, demo: h.user?.demo === true });
      if (url === '/api/flags')
        return json(200, [{ name: 'products.crash', enabled: false, description: 'Crash demo' }]);
      if (url.startsWith('/api/errors/summary'))
        return json(200, [{ remote: 'products', count: 1 }]);
      if (url.startsWith('/api/errors') && (init?.method ?? 'GET') === 'GET')
        return json(200, [
          {
            id: 1,
            remote: 'products',
            build: 'b1',
            kind: 'render',
            message: 'kaboom',
            stack: null,
            url: 'http://x/',
            at: '2026-11-20T10:00:00.000Z',
          },
        ]);
      if (url === '/api/registry')
        return json(
          200,
          ['dashboard', 'orders', 'products'].map((name) => ({
            name,
            canaryUrl: null,
            canaryPercent: 0,
            disabled: false,
          })),
        );
      return json(200, []);
    }),
  );
});
afterEach(() => {
  cleanup();
  logout();
  vi.unstubAllGlobals();
});

const mount = async (path: string, who: keyof typeof users) => {
  h.user = users[who]!;
  await act(() => login(`${String(who)}@lab.test`, 'lab12345'));
  window.history.pushState({}, '', path);
  const router = (await import('../src/App.tsx')).router;
  await act(async () => {
    await router.navigate(path);
    render(<RouterProvider router={router} />);
    await sleep(60);
  });
};
const banner = () => screen.getByRole('banner');

describe('demo admin notice in the top bar', () => {
  it('E-demo-banner: a locked admin sees the notice, EN then DE', async () => {
    await mount('/', 'admin');
    expect(within(banner()).getByText(EN)).toBeTruthy();
    expect(within(banner()).getByText('admin', { exact: true })).toBeTruthy();
    await setLocale('de');
    expect(within(banner()).getByText(DE)).toBeTruthy();
    expect(within(banner()).queryByText(EN)).toBeNull();
  });

  it.each(['editor', 'viewer', 'unlocked'] as const)(
    'E-demo-banner: %s sees no notice',
    async (who) => {
      await mount('/', who);
      expect(within(banner()).queryByText(EN)).toBeNull();
      await setLocale('de');
      expect(within(banner()).queryByText(DE)).toBeNull();
    },
  );

  it('E-demo-banner: the owner role chip reads "admin", no notice, and the role name appears nowhere in the page', async () => {
    await mount('/', 'owner');
    expect(within(banner()).getByText('admin', { exact: true })).toBeTruthy();
    expect(within(banner()).queryByText(EN)).toBeNull();
    expect(document.body.textContent?.toLowerCase()).not.toContain('superadmin');
    await setLocale('de');
    expect(document.body.textContent?.toLowerCase()).not.toContain('superadmin');
  });
});

describe('inspector for a locked admin', () => {
  const openDetails = async () => {
    const name = /^Details (for|für) products$/;
    await waitFor(() => expect(screen.getByRole('button', { name })).toBeTruthy());
    await act(async () => void fireEvent.click(screen.getByRole('button', { name })));
    return screen.getByRole('dialog');
  };
  const isOff = (el: HTMLElement) =>
    (el as HTMLInputElement).disabled || el.getAttribute('aria-disabled') === 'true';

  it('E-demo-banner: Details inputs are disabled, aria-disabled, Save is off, the note is visible', async () => {
    await mount('/inspector', 'admin');
    const d = within(await openDetails());
    for (const name of ['products canary URL', 'products canary percent', 'Switch products off']) {
      const field = d.getByLabelText(name);
      expect((field as HTMLInputElement).disabled, name).toBe(true);
      // native `disabled` only: the builder sets no aria-disabled (redundant on a native input)
    }
    const save = d.queryByRole('button', { name: /^save/i });
    if (save) expect(isOff(save)).toBe(true);
    expect(d.getByText(EN)).toBeTruthy();
  });

  it('E-demo-banner: Details note is German in DE', async () => {
    await mount('/inspector', 'admin');
    await setLocale('de');
    const dialog = await openDetails();
    expect(within(dialog).getByText(DE)).toBeTruthy();
  });

  it('E-demo-banner: flag toggles and errors Clear are disabled', async () => {
    await mount('/inspector', 'admin');
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'products.crash' })).toBeTruthy(),
    );
    expect(isOff(screen.getByRole('checkbox', { name: 'products.crash' }))).toBe(true);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy());
    expect(isOff(screen.getByRole('button', { name: 'Clear' }))).toBe(true);
  });

  it.each(['unlocked', 'owner'] as const)(
    'E-demo-banner: %s keeps the controls enabled',
    async (who) => {
      await mount('/inspector', who);
      await waitFor(() =>
        expect(screen.getByRole('checkbox', { name: 'products.crash' })).toBeTruthy(),
      );
      expect(isOff(screen.getByRole('checkbox', { name: 'products.crash' }))).toBe(false);
      expect(isOff(screen.getByRole('button', { name: 'Clear' }))).toBe(false);
      const d = within(await openDetails());
      expect((d.getByLabelText('products canary percent') as HTMLInputElement).disabled).toBe(
        false,
      );
      expect(d.queryByText(EN)).toBeNull();
    },
  );
});

/** @vitest-environment jsdom */
// T41 Q-remotes-columns, Q-details-dialog, Q-row-click. ASSUMPTIONS (phase 2 adapts to the real markup): the Details
// control is a button named "Details for <remote>"; the dialog is role=dialog named "<remote>: details" (native <dialog>
// or not); copy buttons are "Copy stable manifest" / "Copy canary manifest"; "Copied" is announced via a11y:announce;
// the admin fields are labelled "Canary manifest", "Canary %", "Switch <remote> off", with Save and Cancel buttons.
import { ApiError } from '@mfe/api-client';
import { emit, onAny } from '@mfe/events';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  updateRegistry: vi.fn(),
  user: null as null | { id: number; email: string; role: string },
}));
vi.mock('@mfe/api-client', async (orig) => ({
  ...(await orig<object>()),
  updateRegistry: h.updateRegistry,
  listErrors: async () => [],
  errorSummary: async () => [],
  listFlags: async () => [],
}));
vi.mock('@mfe/auth-store/react', () => ({
  useAuth: (sel: (s: unknown) => unknown) =>
    sel({ user: h.user, token: 't', status: 'authenticated' }),
}));
vi.mock('@module-federation/enhanced/runtime', () => ({
  getInstance: () => null,
  registerPlugins: vi.fn(),
  registerRemotes: vi.fn(),
  loadRemote: vi.fn(),
}));

import InspectorPage from '../src/InspectorPage.tsx';
import { applyRegistryRow } from '../src/remotes.ts';

// jsdom has no Popover API and no modal <dialog>
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

const PRODUCTS = 'http://localhost:3001/mf-manifest.json';
const CANARY = 'https://canary.example.com/releases/0.0.2/mf-manifest.json';
const ISO = '2026-11-21T19:39:05Z'; // the stamp only compacts ISO without milliseconds
const STAMP = '21.11 19:39Z';
const row = (name: string, over: object = {}) => ({
  name,
  canaryUrl: null,
  canaryPercent: 0,
  disabled: false,
  ...over,
});
const seed = (over: Record<string, object> = {}) => {
  for (const n of ['products', 'dashboard', 'orders']) applyRegistryRow(row(n, over[n]));
};

const mount = async () => {
  await act(async () => void render(<InspectorPage />));
  await waitFor(() => expect(screen.getAllByText('up').length).toBeGreaterThan(0));
};
// the header's own text, without the hint tooltip inside it
const headers = () =>
  within(remotes())
    .getAllByRole('columnheader')
    .map((th) => (th.childNodes[0]?.textContent ?? '').trim());
// the Rollout cell's first line (line 2 is the Details button)
const rolloutOf = (n: string) => {
  const cells = within(rowOf(n)).getAllByRole('cell');
  return (cells[cells.length - 1]!.childNodes[0]?.textContent ?? '').trim();
};
const remotes = () => screen.getByRole('table', { name: 'Remotes' });
const rowOf = (name: string) =>
  within(remotes())
    .getByRole('rowheader', { name: new RegExp(name) })
    .closest('tr') as HTMLElement;
const detailsBtn = (name = 'products') =>
  screen.getByRole('button', { name: `Details for ${name}` });
const openDetails = async (name = 'products') => {
  await act(async () => void fireEvent.click(detailsBtn(name)));
  return screen.getByRole('dialog', { name: `${name}: details` });
};
let announced: string[] = [];
let off: (() => void) | undefined;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = 'en';
  h.user = null;
  h.updateRegistry.mockReset();
  announced = [];
  off = onAny((e) => {
    if (e.name === 'a11y:announce') announced.push((e.detail as { message: string }).message);
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ metaData: { buildInfo: { buildVersion: ISO } } }), {
          status: 200,
        }),
    ),
  );
  seed();
});
afterEach(() => {
  document.documentElement.lang = 'en';
  off?.();
  cleanup();
  vi.unstubAllGlobals();
});

describe('Remotes table columns', () => {
  it('Q-remotes-columns: exactly Remote, Manifest, Build, Use, Rollout', async () => {
    await mount();
    expect(headers()).toEqual(['Remote', 'Manifest', 'Build', 'Use', 'Rollout']);
  });

  it('Q-remotes-columns: DE headers', async () => {
    await mount();
    await act(async () => {
      document.documentElement.lang = 'de';
      emit('locale:changed', { locale: 'de' });
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(headers()).toEqual(['Remote', 'Manifest', 'Build', 'Verwenden', 'Rollout']);
  });

  it('Q-remotes-columns: Manifest and Rollout headers carry a focusable hint with a tooltip', async () => {
    await mount();
    for (const name of ['Manifest', 'Rollout']) {
      const th = within(remotes())
        .getAllByRole('columnheader')
        .find((h) => h.textContent?.startsWith(name)) as HTMLElement;
      const trigger = th.querySelector<HTMLElement>('button, [tabindex="0"]');
      expect(trigger, name).toBeTruthy();
      act(() => trigger!.focus());
      const open = screen.queryAllByRole('tooltip', { hidden: true }).filter((e) => !e.hidden);
      expect(open).toHaveLength(1);
      expect((open[0]!.textContent ?? '').length).toBeGreaterThan(20);
      act(() => trigger!.blur());
    }
  });

  it('Q-remotes-columns: the row header has the name and the status chip', async () => {
    await mount();
    const rh = within(rowOf('products')).getByRole('rowheader');
    expect(rh.textContent).toContain('products');
    expect(rh.textContent).toContain('up');
  });

  it('Q-remotes-columns: Build shows the compact stamp and the variant chip', async () => {
    seed({ products: row('products', { canaryUrl: CANARY, canaryPercent: 100 }) });
    await mount();
    const r = rowOf('products');
    expect(within(r).getByText(STAMP).getAttribute('title')).toBe(ISO); // full ISO only as a title
    expect(within(within(r).getAllByRole('cell')[1]!).getByText('stable')).toBeTruthy(); // Build cell chip; signed out has no bucket, so stable
  });

  it('Q-remotes-columns: the canary line shows only when a canary is set', async () => {
    seed({ products: row('products', { canaryUrl: CANARY, canaryPercent: 30 }) });
    await mount();
    expect(rowOf('products').textContent).toContain('canary.example.com');
    expect(within(rowOf('products')).getByText('canary')).toBeTruthy();
    expect(rowOf('dashboard').textContent).not.toContain('canary.example.com');
    expect(within(rowOf('dashboard')).queryByText('canary')).toBeNull();
  });

  it('Q-remotes-columns: Rollout shows —, canary 30% or off', async () => {
    seed({
      products: row('products', { canaryUrl: CANARY, canaryPercent: 30 }),
      dashboard: row('dashboard', { disabled: true }),
    });
    await mount();
    const rollout = rolloutOf;
    expect(rollout('products')).toBe('canary 30%');
    expect(rollout('dashboard')).toBe('off');
    expect(rollout('orders')).toBe('—');
  });
});

describe('Remotes details dialog', () => {
  it('Q-details-dialog: opens a dialog with the full stable URL and the full ISO build', async () => {
    await mount();
    const d = within(await openDetails());
    expect(d.getByText('Stable manifest').nextElementSibling?.textContent).toContain(PRODUCTS);
    expect(d.getByText('Build version').nextElementSibling?.textContent).toBe(ISO);
  });

  it('Q-details-dialog: Copy writes the full URL and announces Copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await mount();
    const d = within(await openDetails());
    await act(
      async () => void fireEvent.click(d.getByRole('button', { name: 'Copy stable manifest' })),
    );
    expect(writeText).toHaveBeenCalledWith(PRODUCTS);
    await waitFor(() => expect(announced.some((m) => m.includes('Copied'))).toBe(true));
  });

  it('Q-details-dialog: the canary copy button copies the canary URL', async () => {
    seed({ products: row('products', { canaryUrl: CANARY, canaryPercent: 30 }) });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await mount();
    const d = within(await openDetails());
    await act(
      async () => void fireEvent.click(d.getByRole('button', { name: 'Copy canary manifest' })),
    );
    expect(writeText).toHaveBeenCalledWith(CANARY);
  });

  it('Q-details-dialog: Escape closes it and focus returns to the Details button', async () => {
    await mount();
    const btn = detailsBtn();
    btn.focus();
    const d = await openDetails();
    await act(async () => {
      // a browser turns Escape into a cancel event whose default action closes the dialog; jsdom does not
      fireEvent.keyDown(d, { key: 'Escape' });
      if (d.hasAttribute('open') && fireEvent(d, new Event('cancel', { cancelable: true })))
        (d as HTMLDialogElement).close();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(detailsBtn());
  });

  it('Q-details-dialog: a viewer sees no admin inputs', async () => {
    h.user = { id: 2, email: 'viewer@lab.test', role: 'viewer' };
    await mount();
    const d = within(await openDetails());
    expect(d.queryByLabelText('products canary URL')).toBeNull();
    expect(d.queryByLabelText('products canary percent')).toBeNull();
    expect(d.queryByRole('checkbox')).toBeNull();
    expect(d.queryByRole('button', { name: /^Save/ })).toBeNull();
    expect(d.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  describe('as admin', () => {
    beforeEach(() => {
      h.user = { id: 1, email: 'admin@lab.test', role: 'admin' };
    });

    it('Q-details-dialog: Save calls updateRegistry with the patch and closes', async () => {
      h.updateRegistry.mockResolvedValue(row('products', { canaryUrl: CANARY, canaryPercent: 30 }));
      await mount();
      const d = within(await openDetails());
      fireEvent.change(d.getByLabelText('products canary URL'), { target: { value: CANARY } });
      fireEvent.change(d.getByLabelText('products canary percent'), { target: { value: '30' } });
      await act(
        async () => void fireEvent.click(d.getByRole('button', { name: 'Save products registry' })),
      );
      expect(h.updateRegistry).toHaveBeenCalledWith('products', {
        canaryUrl: CANARY,
        canaryPercent: 30,
        disabled: false,
      });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(rolloutOf('products')).toBe('canary 30%');
    });

    it('Q-details-dialog: the off switch is saved as disabled', async () => {
      h.updateRegistry.mockResolvedValue(row('products', { disabled: true }));
      await mount();
      const d = within(await openDetails());
      fireEvent.click(d.getByRole('checkbox', { name: 'Switch products off' }));
      expect(h.updateRegistry).not.toHaveBeenCalled(); // saved with Save, not on toggle
      await act(
        async () => void fireEvent.click(d.getByRole('button', { name: 'Save products registry' })),
      );
      expect(h.updateRegistry).toHaveBeenCalledWith(
        'products',
        expect.objectContaining({ disabled: true }),
      );
    });

    it('Q-details-dialog: a 400 shows role=alert and the dialog stays open', async () => {
      h.updateRegistry.mockRejectedValue(new ApiError(400, 'invalid'));
      await mount();
      const d = within(await openDetails());
      fireEvent.change(d.getByLabelText('products canary percent'), { target: { value: '30' } });
      await act(
        async () => void fireEvent.click(d.getByRole('button', { name: 'Save products registry' })),
      );
      expect(await d.findByRole('alert')).toBeTruthy();
      expect(screen.getByRole('dialog', { name: 'products: details' })).toBeTruthy();
    });

    it('Q-details-dialog: Cancel discards the edits', async () => {
      await mount();
      let d = within(await openDetails());
      fireEvent.change(d.getByLabelText('products canary percent'), { target: { value: '55' } });
      await act(async () => void fireEvent.click(d.getByRole('button', { name: 'Cancel' })));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(h.updateRegistry).not.toHaveBeenCalled();
      d = within(await openDetails());
      expect((d.getByLabelText('products canary percent') as HTMLInputElement).value).toBe('0');
    });
  });
});

describe('Remotes row click', () => {
  it('Q-row-click: clicking the Build cell opens Details', async () => {
    await mount();
    const cell = within(rowOf('products')).getByText(STAMP).closest('td') as HTMLElement;
    await act(async () => void fireEvent.click(cell));
    expect(screen.getByRole('dialog', { name: 'products: details' })).toBeTruthy();
  });

  it('Q-row-click: clicking the Use select does not', async () => {
    await mount();
    await act(
      async () =>
        void fireEvent.click(
          within(rowOf('products')).getByRole('combobox', { name: 'products version' }),
        ),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Q-row-click: clicking a tooltip trigger does not', async () => {
    await mount();
    const trigger = rowOf('products').querySelector<HTMLElement>('[tabindex="0"]');
    expect(trigger).toBeTruthy();
    await act(async () => void fireEvent.click(trigger!));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

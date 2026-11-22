/** @vitest-environment jsdom */
// T41 Q-remotes-columns, Q-details-dialog, Q-row-click: remotes table, details dialog, copy buttons, admin fields.
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
  // T58: an up remote has no visible word, only hidden text such as "products, up"
  await waitFor(() =>
    expect(
      within(remotes())
        .getAllByRole('rowheader')
        .some((th) => /\bup\b/.test(th.textContent ?? '')),
    ).toBe(true),
  );
};
// the header's own text, without the hint tooltip inside it
const headers = () =>
  within(remotes())
    .getAllByRole('columnheader')
    .map((th) => (th.childNodes[0]?.textContent ?? '').trim());
// T58: cells are Manifest, Build, Use, Rollout, Details; Rollout is text only
const cellsOf = (n: string) => within(rowOf(n)).getAllByRole('cell');
const rolloutOf = (n: string) => (cellsOf(n)[3]!.textContent ?? '').trim();
// the visually hidden text, matched by the project's .visually-hidden class
const hiddenIn = (el: HTMLElement) => [...el.querySelectorAll('.visually-hidden')];
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
  it('Q-remotes-columns: exactly Remote, Manifest, Build, Use, Rollout, plus a hidden Details header', async () => {
    await mount();
    // T58: the last column has no visible header text; its header reads "Details" to a screen reader
    expect(headers()).toEqual(['Remote', 'Manifest', 'Build', 'Use', 'Rollout', 'Details']);
    const last = within(remotes()).getAllByRole('columnheader').at(-1)!;
    expect(last.querySelector('.visually-hidden')?.textContent).toBe('Details');
  });

  it('Q-remotes-columns: DE headers', async () => {
    await mount();
    await act(async () => {
      document.documentElement.lang = 'de';
      emit('locale:changed', { locale: 'de' });
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(headers()).toEqual(['Remote', 'Manifest', 'Build', 'Verwenden', 'Rollout', 'Details']);
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

  it('Q-remotes-compact: the row header has the name and a status that is not colour only', async () => {
    await mount();
    const rh = within(rowOf('products')).getByRole('rowheader');
    expect(rh.textContent).toContain('products');
    expect(rh.textContent).toMatch(/\bup\b/);
  });

  it('Q-remotes-compact: up has hidden text only, down and off show the word', async () => {
    seed({ dashboard: row('dashboard', { disabled: true }) });
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) =>
      String(url).includes(':3003')
        ? new Response('x', { status: 500 })
        : new Response(JSON.stringify({ metaData: { buildInfo: { buildVersion: ISO } } }), {
            status: 200,
          }),
    );
    await mount();
    const rh = (n: string) => within(rowOf(n)).getByRole('rowheader');
    // up: the word is inside a visually hidden element, never as visible text
    expect(hiddenIn(rh('products')).some((e) => /\bup\b/.test(e.textContent ?? ''))).toBe(true);
    // off and down: the word is visible (not inside .visually-hidden)
    for (const [n, word] of [
      ['dashboard', 'off'],
      ['orders', 'down'],
    ] as const) {
      const hit = within(rh(n)).getByText(word);
      expect(hit.closest('.visually-hidden'), n).toBeNull();
    }
  });

  it('Q-remotes-compact: checking shows a visible "checking…"', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<Response>(() => {}),
    );
    await act(async () => void render(<InspectorPage />));
    const rh = within(rowOf('products')).getByRole('rowheader');
    expect(within(rh).getByText('checking…').closest('.visually-hidden')).toBeNull();
  });

  it('Q-remotes-compact: one line per row, no line-2 elements', async () => {
    seed({ products: row('products', { canaryUrl: CANARY, canaryPercent: 30 }) });
    await mount();
    for (const n of ['products', 'dashboard', 'orders']) {
      const r = rowOf(n);
      expect(within(r).getAllByRole('cell'), n).toHaveLength(5);
      expect(r.querySelectorAll('br'), n).toHaveLength(0);
      // each cell holds one line: no stacked block children (line1/line2 wrappers) inside the cells
      expect(r.querySelectorAll('td .line2, td .sub, td [data-line="2"]'), n).toHaveLength(0);
    }
  });

  it('Q-remotes-compact: the table has no bucket and no stable/canary URL pair as text lines', async () => {
    seed({ products: row('products', { canaryUrl: CANARY, canaryPercent: 30 }) });
    await mount();
    expect(within(remotes()).queryByText(/bucket/i)).toBeNull();
    // the canary URL itself is only in Details
    expect(remotes().textContent).not.toContain('canary.example.com');
  });

  it('Q-remotes-compact: a signed-in user sees no bucket number in the Build cell', async () => {
    h.user = { id: 2, email: 'viewer@lab.test', role: 'viewer' };
    await mount();
    expect(cellsOf('products')[1]!.textContent).not.toMatch(/·\s*\d/);
  });

  it('Q-remotes-compact: the Details button is an icon button with the same accessible name', async () => {
    await mount();
    for (const n of ['products', 'dashboard', 'orders']) {
      const b = within(rowOf(n)).getByRole('button', { name: `Details for ${n}` });
      expect(b.closest('td'), n).toBe(cellsOf(n)[4]);
      expect(b.textContent?.trim(), n).not.toMatch(/^Details$/); // no visible "Details" text
    }
  });

  it('Q-remotes-compact: the Details button name is German in DE', async () => {
    await mount();
    await act(async () => {
      document.documentElement.lang = 'de';
      emit('locale:changed', { locale: 'de' });
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(
      within(remotes()).getByRole('button', { name: /^Details (für|for) products$/ }),
    ).toBeTruthy();
  });

  it('Q-remotes-columns: Build shows the compact stamp and the variant chip', async () => {
    seed({ products: row('products', { canaryUrl: CANARY, canaryPercent: 100 }) });
    await mount();
    const r = rowOf('products');
    expect(within(r).getByText(STAMP).getAttribute('title')).toBe(ISO); // full ISO only as a title
    // Build cell: stamp and variant chip on the same line; signed out has no bucket, so stable
    const build = within(within(r).getAllByRole('cell')[1]!);
    expect(build.getByText('stable')).toBeTruthy();
    expect(build.getByText(STAMP)).toBeTruthy();
    expect(within(r).getAllByRole('cell')[1]!.textContent).not.toMatch(/bucket/i);
  });

  // T58: the canary URL moved to Details; the Manifest cell only gets a small "+ canary" chip
  it('Q-remotes-compact: the + canary chip shows only when a canary is set', async () => {
    seed({ products: row('products', { canaryUrl: CANARY, canaryPercent: 30 }) });
    await mount();
    const manifest = (n: string) => cellsOf(n)[0]!;
    expect(manifest('products').textContent).toMatch(/\+\s*canary/);
    expect(manifest('products').textContent).not.toContain('canary.example.com');
    expect(manifest('products').textContent).toContain('localhost:3001'); // the stable URL stays
    expect(manifest('dashboard').textContent).not.toMatch(/canary/);
    expect(manifest('orders').textContent).not.toMatch(/canary/);
    const d = within(await openDetails());
    expect(d.getByText('Canary manifest').nextElementSibling?.textContent).toContain(CANARY);
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

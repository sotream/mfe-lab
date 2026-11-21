/** @vitest-environment jsdom */
// Q-inspector-headers (T39 amendment). ASSUMPTIONS: each of the three registry headers holds one focusable hint (a button
// or tabindex=0 element) wrapped in the shared Tooltip (role=tooltip); the column header text starts with the new name.
import { emit } from '@mfe/events';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@module-federation/enhanced/runtime', () => ({
  getInstance: () => null,
  registerPlugins: vi.fn(),
  registerRemotes: vi.fn(),
  loadRemote: vi.fn(),
}));

import InspectorPage from '../src/InspectorPage.tsx';

const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
proto.showPopover ??= vi.fn();
proto.hidePopover ??= vi.fn();

const EN = {
  'Stable manifest':
    'Built into the shell at deploy time; everyone loads this unless a canary or a pick applies.',
  'Canary manifest':
    'Optional alternative from the registry; served to Canary % of signed-in users.',
  'Canary %': 'Share of signed-in users (sticky by user) who get the canary.',
} as const;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = 'en';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('no', { status: 500 })),
  );
});
afterEach(() => {
  cleanup();
  document.documentElement.lang = 'en';
  vi.unstubAllGlobals();
});

const mount = () => act(async () => void render(<InspectorPage />));
const setLocale = (locale: 'de' | 'en') =>
  act(async () => {
    document.documentElement.lang = locale;
    emit('locale:changed', { locale });
    await new Promise((r) => setTimeout(r, 30));
  });
const remotes = () => screen.getAllByRole('table')[0] as HTMLElement;
const header = (name: RegExp) => within(remotes()).getByRole('columnheader', { name });
// the popup is always in the DOM (`hidden` when closed); jsdom hides popover=manual, hence hidden:true
const tip = () => {
  const open = screen.queryAllByRole('tooltip', { hidden: true }).filter((e) => !e.hidden);
  expect(open.length).toBeLessThanOrEqual(1);
  return open[0] ?? null;
};
const hint = (th: HTMLElement) =>
  th.querySelector<HTMLElement>('button, [tabindex="0"]') as HTMLElement;

describe('Inspector Remotes headers', () => {
  it('Q-inspector-headers: EN names are Stable manifest, Canary manifest and Canary %', async () => {
    await mount();
    for (const name of Object.keys(EN)) {
      expect(header(new RegExp(`^${name.replace('%', '\\%')}`))).toBeTruthy();
    }
    expect(within(remotes()).queryByRole('columnheader', { name: /^Manifest/ })).toBeNull();
    expect(within(remotes()).queryByRole('columnheader', { name: /^Canary URL/ })).toBeNull();
  });

  it('Q-inspector-headers: DE names are Stabiles Manifest, Canary-Manifest and Canary %', async () => {
    await mount();
    await setLocale('de');
    for (const name of ['Stabiles Manifest', 'Canary-Manifest', 'Canary %']) {
      expect(header(new RegExp(`^${name.replace('%', '\\%')}`))).toBeTruthy();
    }
  });

  for (const [name, sentence] of Object.entries(EN)) {
    it(`Q-inspector-hints: the ${name} hint opens on focus with its sentence`, async () => {
      await mount();
      const th = header(new RegExp(`^${name.replace('%', '\\%')}`));
      const trigger = hint(th);
      expect(trigger).toBeTruthy();
      expect(tip()).toBeNull();
      act(() => trigger.focus());
      const open = tip()!;
      expect(open.textContent).toBe(sentence);
      expect(trigger.getAttribute('aria-describedby')).toBe(open.id);
      act(() => trigger.blur());
      expect(tip()).toBeNull();
    });
  }

  it('Q-inspector-hints: DE hints open on focus with a German sentence', async () => {
    await mount();
    await setLocale('de');
    for (const name of ['Stabiles Manifest', 'Canary-Manifest']) {
      const trigger = hint(header(new RegExp(`^${name}`)));
      act(() => trigger.focus());
      const text = tip()!.textContent ?? '';
      expect(text.length).toBeGreaterThan(10);
      expect(Object.values(EN)).not.toContain(text);
      act(() => trigger.blur());
    }
  });
});

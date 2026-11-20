/** @vitest-environment jsdom */
import type { Stats } from '@mfe/api-client';
import { login, logout } from '@mfe/auth-store';
import { emit } from '@mfe/events';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from '../src/DashboardPage.tsx';

const norm = (s: string | null | undefined) =>
  (s ?? '').replace(new RegExp('[\u00a0\u202f]', 'g'), ' ');
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// 60 orders over 04.10. to 31.10.; the single peak is 4 on 04.10.
const days = [
  { date: '2026-10-04', count: 4 },
  ...Array.from({ length: 18 }, (_, i) => ({
    date: `2026-10-${String(5 + i).padStart(2, '0')}`,
    count: 3,
  })),
  { date: '2026-10-31', count: 2 },
];
const sample: Stats = {
  counts: { products: 1234, orders: 60 },
  revenue_by_status: { new: 1_234_567, paid: 67_428, shipped: 100 },
  orders_per_day: days,
};

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = 'en';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/api/auth/login'
        ? json(200, { token: 't', user: { id: 3, email: 'viewer@lab.test', role: 'viewer' } })
        : url === '/api/flags'
          ? json(404, { error: 'not_found' })
          : json(200, sample),
    ),
  );
});
afterEach(() => {
  cleanup();
  logout();
  localStorage.clear();
  document.documentElement.lang = '';
  vi.unstubAllGlobals();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mount = async () => {
  await act(() => login('viewer@lab.test', 'lab12345'));
  await act(async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    await sleep(20);
  });
};
const setLocale = (locale: 'de' | 'en') =>
  act(async () => {
    document.documentElement.lang = locale;
    emit('locale:changed', { locale });
    await sleep(20);
  });
const svg = () => document.querySelector('svg[role="img"]') as SVGElement;
const dds = () =>
  Array.from(document.querySelectorAll('dl dd')).map((d) => norm(d.textContent).trim());
const dateTicks = () =>
  Array.from(svg().querySelectorAll('text'))
    .map((t) => (t.textContent ?? '').trim())
    .filter((t) => /^\d{2}[./]\d{2}/.test(t));
const bars = () => Array.from(document.querySelectorAll<SVGRectElement>('rect[data-date]'));

const EN_LABEL = 'Orders per day, 04/10/2026 to 31/10/2026: 60 orders, peak 4 on 04/10/2026';
const DE_LABEL =
  'Bestellungen pro Tag, 04.10.2026 bis 31.10.2026: 60 Bestellungen, Spitze 4 am 04.10.2026';

describe('dashboard locale', () => {
  it('Q-format: EN shows en-GB dates, EUR money and grouped counts', async () => {
    await mount();
    expect(svg().getAttribute('aria-label')).toBe(EN_LABEL);
    expect(dds()).toEqual(expect.arrayContaining(['1,234', '60', '€13,020.95', '€674.28']));
    const ticks = dateTicks();
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) expect(t, t).toMatch(/^\d{2}\/\d{2}$/);
  });

  it('Q-remote-locale: re-renders in place on locale:changed', async () => {
    await mount();
    const root = svg();
    await setLocale('de');
    expect(svg().getAttribute('aria-label')).toBe(DE_LABEL);
    expect(dds()).toEqual(expect.arrayContaining(['1.234', '60', '13.020,95 €', '674,28 €']));
    const ticks = dateTicks();
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) expect(t, t).toMatch(/^\d{2}\.\d{2}\.$/);
    expect(bars().map((b) => b.getAttribute('data-date'))[0]).toBe('2026-10-04'); // day keys stay ISO
    expect(svg()).toBe(root); // same DOM, not remounted

    await setLocale('en');
    expect(svg().getAttribute('aria-label')).toBe(EN_LABEL);
  });

  it('Q-remote-locale: a remote mounted after a switch reads <html lang>', async () => {
    document.documentElement.lang = 'de';
    await mount();
    expect(svg().getAttribute('aria-label')).toBe(DE_LABEL);
    expect(dds()).toContain('1.234');
  });

  it('Q-de-strings: tooltip and data table use dd.mm.yyyy in DE', async () => {
    document.documentElement.lang = 'de';
    await mount();
    await act(async () => void fireEvent.mouseEnter(bars()[0]!));
    expect(screen.getByRole('tooltip').textContent).toContain('04.10.2026');

    const table = document.querySelector('details table') as HTMLTableElement;
    const first = Array.from(
      table.querySelectorAll('tbody tr')[0]?.querySelectorAll('td, th') ?? [],
    );
    expect(first.map((c) => c.textContent?.trim())).toEqual(['04.10.2026', '4']);
  });

  it('Q-table-caption: the data table caption is German in DE', async () => {
    document.documentElement.lang = 'de';
    await mount();
    expect(screen.getByRole('table', { name: 'Bestellungen pro Tag', hidden: true })).toBeTruthy();
  });

  it('Q-de-strings: status labels are neu, bezahlt, versandt in DE', async () => {
    await mount();
    // The German heading is not in the contract: find the section by its EN heading, then switch.
    const section = screen.getByRole('heading', { name: 'Revenue by status' }).closest('section')!;
    expect(section.textContent).toContain('paid');
    await setLocale('de');
    const text = section.textContent ?? '';
    const at = ['neu', 'bezahlt', 'versandt'].map((s) => text.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(text).not.toMatch(/\b(new|paid|shipped)\b/);
    expect(norm(text)).toContain('12.345,67 €');
  });
});

/** @vitest-environment jsdom */
import type { Stats } from '@mfe/api-client';
import { login, logout } from '@mfe/auth-store';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from '../src/DashboardPage.tsx';
import { fillDays, formatCents, totalRevenue, yTicks } from '../src/stats.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const sample: Stats = {
  counts: { products: 30, orders: 60 },
  revenue_by_status: { new: 12_345, paid: 500_000, shipped: 250_000 },
  orders_per_day: [
    { date: '2026-10-04', count: 1 },
    { date: '2026-10-01', count: 2 },
    { date: '2026-10-03', count: 5 },
  ],
};

// Fake API: login always succeeds as viewer; /api/stats answers via `stats`.
const server = (stats: () => Response | Promise<Response> = () => json(200, sample)) => {
  const fetch = vi.fn(async (url: string) =>
    url === '/api/auth/login'
      ? json(200, { token: 't', user: { id: 3, email: 'viewer@lab.test', role: 'viewer' } })
      : stats(),
  );
  vi.stubGlobal('fetch', fetch);
  return { statsCalls: () => fetch.mock.calls.filter(([u]) => u === '/api/stats').length };
};

// React 19 + RTL: every step inside an awaited act(), as in T4.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mount = async () => {
  await act(() => login('viewer@lab.test', 'lab12345'));
  await act(async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    await sleep(0);
  });
};

const figure = () => {
  const caption = screen.getByText('Orders per day', { selector: 'figcaption' });
  return caption.closest('figure') as HTMLElement;
};
const columns = () => Array.from(figure().querySelectorAll<SVGRectElement>('rect[data-date]'));
const num = (el: Element, attr: string) => Number(el.getAttribute(attr));
// Y tick labels: svg text that is a plain integer (date labels contain '-').
const yLabels = () =>
  Array.from(figure().querySelectorAll('svg text'))
    .map((t) => (t.textContent ?? '').trim())
    .filter((t) => /^\d+$/.test(t))
    .map(Number);
const noNaN = (root: Element) => {
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const { name, value } of Array.from(el.attributes)) {
      expect(value, `${el.tagName}[${name}]`).not.toMatch(/NaN|Infinity/);
    }
  }
};

afterEach(() => {
  cleanup();
  logout();
  vi.unstubAllGlobals();
});

describe('DashboardPage', () => {
  it('Q-page-loading: one getStats on mount, status while pending', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const api = server(async () => {
      await gate;
      return json(200, sample);
    });
    await mount();
    expect(screen.getByRole('status').textContent).toContain('Loading dashboard…');
    expect(api.statsCalls()).toBe(1);
    await act(async () => {
      release();
      await sleep(0);
    });
    expect(screen.queryByRole('status')).toBeNull();
    expect(api.statsCalls()).toBe(1);
  });

  it('Q-page-error: 500 shows the alert, Retry refetches', async () => {
    let fail = true;
    const api = server(() => (fail ? json(500, { error: 'internal' }) : json(200, sample)));
    await mount();
    expect(screen.getByRole('alert').textContent).toContain('Could not load dashboard');
    fail = false;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await sleep(0);
    });
    expect(api.statsCalls()).toBe(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(figure()).toBeTruthy();
  });

  it('Q-page-tiles: dl term/definition pairs', async () => {
    server();
    await mount();
    const pairs = Object.fromEntries(
      Array.from(document.querySelectorAll('dl dt')).map((dt) => [
        (dt.textContent ?? '').trim(),
        (dt.nextElementSibling?.textContent ?? '').trim(),
      ]),
    );
    expect(pairs).toMatchObject({
      Products: '30',
      Orders: '60',
      Revenue: formatCents(totalRevenue(sample.revenue_by_status)),
      'Paid revenue': formatCents(500_000),
    });
    expect(pairs.Revenue).toBe('$7,623.45');
  });

  it('Q-page-chart: gap-filled columns, proportional heights, label, y ticks', async () => {
    server();
    await mount();
    const filled = fillDays(sample.orders_per_day);
    expect(filled.map((d) => d.count)).toEqual([2, 0, 5, 1]);
    const rects = columns();
    expect(rects.map((r) => r.getAttribute('data-date'))).toEqual(filled.map((d) => d.date));
    expect(rects.map((r) => num(r, 'data-count'))).toEqual([2, 0, 5, 1]);

    const tallest = num(rects[2] as Element, 'height');
    expect(tallest).toBeGreaterThan(0);
    rects.forEach((r, i) => {
      const count = filled[i]?.count ?? 0;
      expect(num(r, 'height'), r.getAttribute('data-date') ?? '').toBeCloseTo(
        (tallest * count) / 5,
        5,
      );
    });
    expect(num(rects[1] as Element, 'height')).toBe(0);

    expect(
      screen.getByRole('img', { name: 'Orders per day, 2026-10-01 to 2026-10-04' }),
    ).toBeTruthy();
    expect(yLabels()).toEqual(yTicks(5));
    noNaN(figure());
  });

  it('Q-page-tooltip: hover and keyboard focus show one tooltip per column', async () => {
    server();
    await mount();
    const rects = columns();
    rects.forEach((r) => {
      expect(r.getAttribute('tabindex')).toBe('0');
      expect(r.getAttribute('aria-label')).toBe(
        `${r.getAttribute('data-date')}: ${r.getAttribute('data-count')} orders`,
      );
    });
    const [first, , peak] = rects as [SVGRectElement, SVGRectElement, SVGRectElement];

    await act(async () => void fireEvent.mouseEnter(peak));
    let tips = screen.getAllByRole('tooltip');
    expect(tips).toHaveLength(1);
    expect(tips[0]?.textContent).toContain('2026-10-03 · 5 orders');

    await act(async () => {
      fireEvent.mouseLeave(peak);
      first.focus();
    });
    tips = screen.getAllByRole('tooltip');
    expect(tips).toHaveLength(1);
    expect(tips[0]?.textContent).toContain('2026-10-01 · 2 orders');
  });

  it('Q-page-revenue: new, paid, shipped in order with values; widest bar is the largest', async () => {
    server();
    await mount();
    const section = screen.getByRole('heading', { name: 'Revenue by status' }).closest('section');
    expect(section).not.toBeNull();
    const text = section?.textContent ?? '';
    const at = ['new', 'paid', 'shipped'].map((s) => text.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    for (const v of [12_345, 500_000, 250_000]) expect(text).toContain(formatCents(v));

    // A bar is an svg rect with a width attribute or an element with an inline style width.
    const bars = Array.from(
      section?.querySelectorAll<HTMLElement>('rect[width], [style*="width"]') ?? [],
    );
    expect(bars).toHaveLength(3);
    const widths = bars.map((b) => parseFloat(b.getAttribute('width') ?? b.style.width));
    expect(widths[1]).toBe(Math.max(...widths));
    expect((widths[2] ?? 0) / (widths[1] ?? 1)).toBeCloseTo(0.5, 2);
    expect((widths[0] ?? 0) / (widths[1] ?? 1)).toBeCloseTo(12_345 / 500_000, 2);
  });

  it('Q-page-table: details table lists every filled day', async () => {
    server();
    await mount();
    const summary = screen.getByText('Show data table', { selector: 'summary' });
    const table = summary.closest('details')?.querySelector('table');
    expect(table).toBeTruthy();
    const headers = Array.from(table?.querySelectorAll('th') ?? []).map((th) =>
      th.textContent?.trim(),
    );
    expect(headers).toEqual(expect.arrayContaining(['Date', 'Orders']));
    const body = Array.from(table?.querySelectorAll('tbody tr') ?? []).map((tr) =>
      Array.from(tr.querySelectorAll('td, th')).map((c) => c.textContent?.trim()),
    );
    expect(body).toEqual(fillDays(sample.orders_per_day).map((d) => [d.date, String(d.count)]));
  });

  it('Q-page-empty: no orders shows the empty text and no svg', async () => {
    server(() => json(200, { ...sample, orders_per_day: [] }));
    await mount();
    expect(figure().textContent).toContain('No orders yet');
    expect(figure().querySelector('svg')).toBeNull();
  });

  it('Q-page-single-day: one day renders one column without NaN', async () => {
    server(() => json(200, { ...sample, orders_per_day: [{ date: '2026-10-02', count: 7 }] }));
    await mount();
    const rects = columns();
    expect(rects).toHaveLength(1);
    expect(num(rects[0] as Element, 'height')).toBeGreaterThan(0);
    expect(
      screen.getByRole('img', { name: 'Orders per day, 2026-10-02 to 2026-10-02' }),
    ).toBeTruthy();
    noNaN(figure());
  });
});

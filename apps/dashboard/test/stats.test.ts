import { describe, expect, it } from 'vitest';
import { fillDays, formatCents, niceMax, totalRevenue, yTicks } from '../src/stats.ts';

const DAY = 86_400_000;
const utc = (date: string) => Date.parse(`${date}T00:00:00.000Z`);
const day = (date: string, count: number) => ({ date, count });

describe('stats mapping', () => {
  it('Q-format-cents: dollars with thousands separators, no float drift', () => {
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(10)).toBe('$0.10');
    expect(formatCents(1_234_567)).toBe('$12,345.67');
    expect(formatCents(123_456_789)).toBe('$1,234,567.89');
  });

  it('Q-fill-gaps: missing days are 0, input is sorted, empty stays empty', () => {
    const want = [
      day('2026-10-01', 2),
      day('2026-10-02', 0),
      day('2026-10-03', 0),
      day('2026-10-04', 1),
    ];
    expect(fillDays([day('2026-10-01', 2), day('2026-10-04', 1)])).toEqual(want);
    expect(fillDays([day('2026-10-04', 1), day('2026-10-01', 2)])).toEqual(want);
    expect(fillDays([day('2026-10-02', 3)])).toEqual([day('2026-10-02', 3)]);
    expect(fillDays([])).toEqual([]);
  });

  it('Q-fill-month: month boundary and DST change keep exactly one entry per UTC day', () => {
    expect(fillDays([day('2026-10-31', 1), day('2026-11-02', 4)])).toEqual([
      day('2026-10-31', 1),
      day('2026-11-01', 0),
      day('2026-11-02', 4),
    ]);
    // EU clocks change on 2026-03-29 (and back on 2026-10-25).
    for (const [from, to] of [
      ['2026-03-27', '2026-04-02'],
      ['2026-10-23', '2026-10-28'],
    ] as const) {
      const dates = fillDays([day(to, 1), day(from, 1)]).map((d) => d.date);
      expect(dates[0]).toBe(from);
      expect(dates.at(-1)).toBe(to);
      expect(dates).toHaveLength((utc(to) - utc(from)) / DAY + 1);
      for (let i = 1; i < dates.length; i++) {
        expect(utc(dates[i] ?? '') - utc(dates[i - 1] ?? ''), dates[i]).toBe(DAY);
      }
    }
  });

  it('Q-total: sum of new, paid and shipped', () => {
    expect(totalRevenue({ new: 1, paid: 20, shipped: 300 })).toBe(321);
    expect(totalRevenue({ new: 0, paid: 0, shipped: 0 })).toBe(0);
  });

  it('Q-nicemax: smallest {1,2,5}x10^k at or above max', () => {
    const cases: [number, number][] = [
      [0, 1],
      [1, 1],
      [7, 10],
      [12, 20],
      [50, 50],
      [51, 100],
    ];
    for (const [max, nice] of cases) expect(niceMax(max), String(max)).toBe(nice);
  });

  it('Q-yticks: from 0 to niceMax, evenly spaced increasing integers, 2..6 values', () => {
    for (const max of [7, 12, 50, 99, 2, 5, 230]) {
      const ticks = yTicks(max);
      const label = `${max} -> ${JSON.stringify(ticks)}`;
      expect(ticks[0], label).toBe(0);
      expect(ticks.at(-1), label).toBe(niceMax(max));
      expect(ticks.length, label).toBeGreaterThanOrEqual(2);
      expect(ticks.length, label).toBeLessThanOrEqual(6);
      const step = (ticks[1] ?? 0) - (ticks[0] ?? 0);
      ticks.forEach((t, i) => {
        expect(Number.isInteger(t), label).toBe(true);
        expect(t, label).toBe(i * step);
      });
    }
  });

  it('Q-yticks-small: no integer step for niceMax 1, so max 0 and 1 give [0, 1]', () => {
    expect(yTicks(0)).toEqual([0, 1]);
    expect(yTicks(1)).toEqual([0, 1]);
  });
});

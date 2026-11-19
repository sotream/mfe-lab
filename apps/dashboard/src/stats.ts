import type { Stats } from '@mfe/api-client';

// Integer math on cents, so large amounts never drift: 123456789 -> "$1,234,567.89".
export function formatCents(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100).toLocaleString('en-US');
  const rest = String(abs % 100).padStart(2, '0');
  return `${cents < 0 ? '-' : ''}$${dollars}.${rest}`;
}

const DAY_MS = 86_400_000;
const toUtc = (date: string) => Date.parse(`${date}T00:00:00Z`);

// Every UTC day from the first to the last date present; days without orders count 0.
export function fillDays(days: { date: string; count: number }[]) {
  if (days.length === 0) return [];
  const byDate = new Map(days.map((d) => [d.date, d.count]));
  const times = days.map((d) => toUtc(d.date));
  const first = Math.min(...times);
  const last = Math.max(...times);
  const filled: { date: string; count: number }[] = [];
  for (let t = first; t <= last; t += DAY_MS) {
    const date = new Date(t).toISOString().slice(0, 10);
    filled.push({ date, count: byDate.get(date) ?? 0 });
  }
  return filled;
}

export const totalRevenue = (r: Stats['revenue_by_status']): number => r.new + r.paid + r.shipped;

// Smallest value in {1, 2, 5} x 10^k that is >= max (0 gives 1, so scales never divide by zero).
export function niceMax(max: number): number {
  for (let magnitude = 1; ; magnitude *= 10) {
    for (const m of [1, 2, 5]) if (m * magnitude >= max) return m * magnitude;
  }
}

// 0 .. niceMax in integer steps: /4, else /5, else /2; niceMax 1 has none, so [0, 1].
export function yTicks(max: number): number[] {
  const top = niceMax(max);
  const divisor = [4, 5, 2].find((d) => top % d === 0);
  if (!divisor) return [0, top];
  const step = top / divisor;
  return Array.from({ length: divisor + 1 }, (_, i) => i * step);
}

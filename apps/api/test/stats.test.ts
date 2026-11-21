import { describe, expect, it } from 'vitest';
import { call, freshApp, type Ctx } from './helpers.ts';

type Stats = {
  counts: { products: number; orders: number };
  revenue_by_status: { new: number; paid: number; shipped: number };
  orders_per_day: { date: string; count: number }[];
};

const stats = async (ctx: Ctx) => {
  const res = await call(ctx, { url: '/stats', as: 'viewer' });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Stats>();
};

describe('stats', () => {
  it('Q-stats: counts, revenue and orders per day match SQL; new order bumps count', async () => {
    const ctx = await freshApp();
    const body = await stats(ctx);
    expect(body.counts).toEqual({ products: 30, orders: 60 });

    const revenue = { new: 0, paid: 0, shipped: 0 };
    const rows = await ctx.app.db.query<{ status: keyof typeof revenue; r: number }>(
      `SELECT o.status AS status, sum(o.qty * p.price_cents)::int AS r
       FROM orders o JOIN products p ON p.id = o.product_id GROUP BY o.status`,
    );
    for (const { status, r } of rows) revenue[status] = r;
    expect(body.revenue_by_status).toEqual(revenue);

    const perDay = await ctx.app.db.query(
      `SELECT to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') AS date, count(*)::int AS count
       FROM orders GROUP BY 1 ORDER BY 1`,
    );
    expect(body.orders_per_day).toEqual(perDay);
    const dates = body.orders_per_day.map((d) => d.date);
    for (const d of dates) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Set(dates).size).toBe(dates.length);
    expect([...dates].sort()).toEqual(dates);
    expect(body.orders_per_day.reduce((sum, d) => sum + d.count, 0)).toBe(60);

    const created = await call(ctx, {
      method: 'POST',
      url: '/orders',
      payload: { product_id: 1, qty: 1 },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect((await stats(ctx)).counts).toEqual({ products: 30, orders: 61 });
  });
});

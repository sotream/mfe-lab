import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, freshApp, isIso, isoCol, keysOf, orderKeys, setup, type Ctx } from './helpers.ts';

type Order = { id: number; product_id: number; qty: number; status: string; created_at: string };
type Page = { items: Order[]; total: number; page: number; limit: number };

let ctx: Ctx; // read-only shared app; mutating tests use freshApp()
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => ctx.app.close());

const expectError = (
  res: { statusCode: number; json: () => unknown },
  status: number,
  error: string,
) => {
  expect(res.statusCode).toBe(status);
  expect(res.json()).toEqual({ error });
};

describe('orders', () => {
  it('Q-orders-list: 20 of 60, created_at desc then id desc; status filter', async () => {
    const res = await call(ctx, { url: '/orders', as: 'viewer' });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<Page>();
    expect(body).toMatchObject({ total: 60, page: 1, limit: 20 });
    const want = await ctx.app.db.query<Order>(
      `SELECT id, product_id, qty, status, ${isoCol()} FROM orders ORDER BY orders.created_at DESC, id DESC LIMIT 20`,
    );
    expect(body.items).toEqual(want);
    for (const o of body.items) expect(keysOf(o)).toEqual(orderKeys);

    const paid = await call(ctx, { url: '/orders', as: 'viewer', query: { status: 'paid' } });
    const [{ n }] = (await ctx.app.db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM orders WHERE status = 'paid'",
    )) as [{ n: number }];
    expect(paid.json<Page>().total).toBe(n);
    expect(paid.json<Page>().items.every((o) => o.status === 'paid')).toBe(true);

    const lost = await call(ctx, { url: '/orders', as: 'viewer', query: { status: 'lost' } });
    expectError(lost, 400, 'invalid_query');
  });

  it('Q-orders-write: admin creates and patches; 409, 400 and 404 cases', async () => {
    const c = await freshApp();
    const post = (payload: object) => call(c, { method: 'POST', url: '/orders', payload });
    const patch = (id: number, payload: object) =>
      call(c, { method: 'PATCH', url: `/orders/${id}`, payload });

    const res = await post({ product_id: 1, qty: 2 });
    expect(res.statusCode, res.body).toBe(201);
    const created = res.json<Order>();
    expect(keysOf(created)).toEqual(orderKeys);
    expect(created).toMatchObject({ product_id: 1, qty: 2, status: 'new' });
    expect(isIso(created.created_at)).toBe(true);
    expect(Math.abs(Date.parse(created.created_at) - Date.now())).toBeLessThan(60_000);

    expectError(await post({ product_id: 99_999, qty: 1 }), 409, 'conflict');
    expectError(await post({ product_id: 1, qty: 0 }), 400, 'invalid_body');

    const shipped = await patch(created.id, { status: 'shipped' });
    expect(shipped.statusCode, shipped.body).toBe(200);
    expect(shipped.json()).toEqual({ ...created, status: 'shipped' });
    expectError(await patch(created.id, { status: 'lost' }), 400, 'invalid_body');
    expectError(await patch(9999, { status: 'paid' }), 404, 'not_found');
  });
});

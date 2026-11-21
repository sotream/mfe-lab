import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from './common.ts';

const stats = z.object({
  counts: z.object({ products: z.number().int(), orders: z.number().int() }),
  revenue_by_status: z.object({ new: z.number(), paid: z.number(), shipped: z.number() }),
  orders_per_day: z.array(z.object({ date: z.string(), count: z.number().int() })),
});

export const statsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/stats',
    {
      onRequest: app.authenticate,
      schema: { tags: ['stats'], response: { 200: stats, ...errors(401) } },
    },
    async () => {
      const one = async (sql: string) => (await app.db.query<{ n: number }>(sql))[0]!.n;
      const revenue = await app.db.query<{ status: 'new' | 'paid' | 'shipped'; revenue: number }>(
        `select o.status, coalesce(sum(o.qty * p.price_cents), 0) as revenue
         from orders o join products p on p.id = o.product_id group by o.status`,
      );
      const revenue_by_status = { new: 0, paid: 0, shipped: 0 };
      for (const r of revenue) revenue_by_status[r.status] = r.revenue;

      return {
        counts: {
          products: await one('select count(*)::int as n from products'),
          orders: await one('select count(*)::int as n from orders'),
        },
        revenue_by_status,
        // Days are UTC.
        orders_per_day: await app.db.query<{ date: string; count: number }>(
          `select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as date, count(*)::int as count
           from orders group by 1 order by 1`,
        ),
      };
    },
  );
};

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
      const one = (sql: string) => app.db.prepare(sql).get() as { n: number };
      const revenue = app.db
        .prepare(
          `select o.status, coalesce(sum(o.qty * p.price_cents), 0) as revenue
           from orders o join products p on p.id = o.product_id group by o.status`,
        )
        .all() as { status: 'new' | 'paid' | 'shipped'; revenue: number }[];
      const revenue_by_status = { new: 0, paid: 0, shipped: 0 };
      for (const r of revenue) revenue_by_status[r.status] = r.revenue;

      return {
        counts: {
          products: one('select count(*) as n from products').n,
          orders: one('select count(*) as n from orders').n,
        },
        revenue_by_status,
        // Days are UTC: created_at is an ISO-8601 UTC string.
        orders_per_day: app.db
          .prepare(
            'select substr(created_at, 1, 10) as date, count(*) as count from orders group by 1 order by 1',
          )
          .all() as { date: string; count: number }[],
      };
    },
  );
};

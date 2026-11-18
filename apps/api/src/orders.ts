import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors, idParams, pageQuery, paged } from './common.ts';

const status = z.enum(['new', 'paid', 'shipped']);
const order = z.object({
  id: z.number().int(),
  product_id: z.number().int(),
  qty: z.number().int(),
  status,
  created_at: z.string(),
});

const COLUMNS = 'id, product_id, qty, status, created_at';

// ponytail: no stock decrement on order creation and no status transition rules (spec is
// silent); add both when orders need to mean something.
export const orderRoutes: FastifyPluginAsyncZod = async (app) => {
  const get = (id: number) =>
    app.db.prepare(`select ${COLUMNS} from orders where id = ?`).get(id) as
      z.infer<typeof order> | undefined;
  const writer = { onRequest: app.requireRole('admin') };

  app.get(
    '/orders',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['orders'],
        querystring: z.object({ ...pageQuery, status: status.optional() }),
        response: { 200: paged(order), ...errors(400, 401) },
      },
    },
    async (request) => {
      const { page, limit, status } = request.query;
      const where = status ? 'where status = @status' : '';
      const params = status ? { status } : {};
      const { n } = app.db.prepare(`select count(*) as n from orders ${where}`).get(params) as {
        n: number;
      };
      const items = app.db
        .prepare(
          `select ${COLUMNS} from orders ${where} order by created_at desc, id desc limit @limit offset @offset`,
        )
        .all({ ...params, limit, offset: (page - 1) * limit }) as z.infer<typeof order>[];
      return { items, total: n, page, limit };
    },
  );

  app.post(
    '/orders',
    {
      ...writer,
      schema: {
        tags: ['orders'],
        body: z.object({
          product_id: z.number().int().min(1),
          qty: z.number().int().min(1).max(1000),
        }),
        response: { 201: order, ...errors(400, 401, 403, 409) },
      },
    },
    async (request, reply) => {
      const { product_id, qty } = request.body;
      const info = app.db
        .prepare('insert into orders (product_id, qty, status, created_at) values (?, ?, ?, ?)')
        .run(product_id, qty, 'new', new Date().toISOString());
      return reply.code(201).send(get(Number(info.lastInsertRowid))!);
    },
  );

  app.patch(
    '/orders/:id',
    {
      ...writer,
      schema: {
        tags: ['orders'],
        params: idParams,
        body: z.object({ status }),
        response: { 200: order, ...errors(400, 401, 403, 404) },
      },
    },
    async (request, reply) => {
      const info = app.db
        .prepare('update orders set status = ? where id = ?')
        .run(request.body.status, request.params.id);
      if (info.changes === 0) return reply.code(404).send({ error: 'not_found' });
      return get(request.params.id)!;
    },
  );
};

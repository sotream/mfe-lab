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

// Limitation: no stock decrement on order creation and no status transition rules (the spec is
// silent); upgrade path: add both when orders need to mean something.
export const orderRoutes: FastifyPluginAsyncZod = async (app) => {
  const get = async (id: number) =>
    (
      await app.db.query<z.infer<typeof order>>(`select ${COLUMNS} from orders where id = $1`, [id])
    )[0];
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
      const where = status ? 'where status = $1' : '';
      const params: unknown[] = status ? [status] : [];
      const [count] = await app.db.query<{ n: number }>(
        `select count(*)::int as n from orders ${where}`,
        params,
      );
      const items = await app.db.query<z.infer<typeof order>>(
        `select ${COLUMNS} from orders ${where} order by created_at desc, id desc limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, limit, (page - 1) * limit],
      );
      return { items, total: count!.n, page, limit };
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
          qty: z.number().int().min(1).max(10_000),
        }),
        response: { 201: order, ...errors(400, 401, 403, 409) },
      },
    },
    async (request, reply) => {
      const { product_id, qty } = request.body;
      const [row] = await app.db.query<{ id: number }>(
        'insert into orders (product_id, qty, status, created_at) values ($1, $2, $3, $4) returning id',
        [product_id, qty, 'new', new Date().toISOString()],
      );
      return reply.code(201).send((await get(row!.id))!);
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
      const [row] = await app.db.query<z.infer<typeof order>>(
        `update orders set status = $1 where id = $2 returning ${COLUMNS}`,
        [request.body.status, request.params.id],
      );
      return row ?? reply.code(404).send({ error: 'not_found' });
    },
  );
};

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors, idParams, pageQuery, paged } from './common.ts';

const product = z.object({
  id: z.number().int(),
  sku: z.string(),
  name: z.string(),
  price_cents: z.number().int(),
  stock: z.number().int(),
  created_at: z.string(),
});

const fields = z.object({
  sku: z.string().min(1).max(32),
  name: z.string().min(1).max(120),
  price_cents: z.number().int().min(0),
  stock: z.number().int().min(0),
});

const SORTS = ['id', 'sku', 'name', 'price_cents', 'stock', 'created_at'] as const;
const listQuery = z.object({
  ...pageQuery,
  sort: z.enum(SORTS).default('id'),
  order: z.enum(['asc', 'desc']).default('asc'),
  q: z.string().optional(),
});

const COLUMNS = 'id, sku, name, price_cents, stock, created_at';

export const productRoutes: FastifyPluginAsyncZod = async (app) => {
  const get = async (id: number) =>
    (
      await app.db.query<z.infer<typeof product>>(`select ${COLUMNS} from products where id = $1`, [
        id,
      ])
    )[0];
  const reader = { onRequest: app.authenticate };
  const writer = { onRequest: app.requireRole('admin', 'editor') };

  app.get(
    '/products',
    {
      ...reader,
      schema: {
        tags: ['products'],
        querystring: listQuery,
        response: { 200: paged(product), ...errors(400, 401) },
      },
    },
    async (request) => {
      const { page, limit, sort, order, q } = request.query;
      const params: unknown[] = q ? [`%${q.replace(/[\\%_]/g, '\\$&')}%`] : [];
      const where = q ? "where name ilike $1 escape '\\' or sku ilike $1 escape '\\'" : '';
      const [count] = await app.db.query<{ n: number }>(
        `select count(*)::int as n from products ${where}`,
        params,
      );
      // sort and order are zod enums, so interpolating them is safe.
      const items = await app.db.query<z.infer<typeof product>>(
        `select ${COLUMNS} from products ${where} order by ${sort} ${order}, id asc limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, limit, (page - 1) * limit],
      );
      return { items, total: count!.n, page, limit };
    },
  );

  app.get(
    '/products/:id',
    {
      ...reader,
      schema: {
        tags: ['products'],
        params: idParams,
        response: { 200: product, ...errors(400, 401, 404) },
      },
    },
    async (request, reply) =>
      (await get(request.params.id)) ?? reply.code(404).send({ error: 'not_found' }),
  );

  app.post(
    '/products',
    {
      ...writer,
      schema: {
        tags: ['products'],
        body: fields,
        response: { 201: product, ...errors(400, 401, 403, 409) },
      },
    },
    async (request, reply) => {
      const b = request.body;
      const [row] = await app.db.query<{ id: number }>(
        'insert into products (sku, name, price_cents, stock, created_at) values ($1, $2, $3, $4, $5) returning id',
        [b.sku, b.name, b.price_cents, b.stock, new Date().toISOString()],
      );
      return reply.code(201).send((await get(row!.id))!);
    },
  );

  app.patch(
    '/products/:id',
    {
      ...writer,
      schema: {
        tags: ['products'],
        params: idParams,
        body: fields.partial().refine((o) => Object.keys(o).length > 0, 'empty body'),
        response: { 200: product, ...errors(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      // Keys come from the parsed zod object, so they are the known column names.
      const data = request.body;
      const keys = Object.keys(data);
      const set = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
      const hit = await app.db.query(
        `update products set ${set} where id = $${keys.length + 1} returning id`,
        [...Object.values(data), request.params.id],
      );
      if (hit.length === 0) return reply.code(404).send({ error: 'not_found' });
      return (await get(request.params.id))!;
    },
  );

  // A product with orders is never deleted: the FK violation becomes 409 conflict.
  app.delete(
    '/products/:id',
    {
      ...writer,
      schema: {
        tags: ['products'],
        params: idParams,
        response: { 204: z.null(), ...errors(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const hit = await app.db.query('delete from products where id = $1 returning id', [
        request.params.id,
      ]);
      if (hit.length === 0) return reply.code(404).send({ error: 'not_found' });
      return reply.code(204).send(null);
    },
  );
};

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
  const get = (id: number) =>
    app.db.prepare(`select ${COLUMNS} from products where id = ?`).get(id) as
      z.infer<typeof product> | undefined;
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
      // ponytail: SQLite lower() only folds ASCII; non-ASCII names match case-sensitively.
      const pattern = q ? `%${q.toLowerCase().replace(/[\\%_]/g, '\\$&')}%` : null;
      const where = pattern
        ? "where lower(name) like @pattern escape '\\' or lower(sku) like @pattern escape '\\'"
        : '';
      const params = pattern ? { pattern } : {};
      const { n } = app.db.prepare(`select count(*) as n from products ${where}`).get(params) as {
        n: number;
      };
      // sort and order are zod enums, so interpolating them is safe.
      const items = app.db
        .prepare(
          `select ${COLUMNS} from products ${where} order by ${sort} ${order}, id asc limit @limit offset @offset`,
        )
        .all({ ...params, limit, offset: (page - 1) * limit }) as z.infer<typeof product>[];
      return { items, total: n, page, limit };
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
      get(request.params.id) ?? reply.code(404).send({ error: 'not_found' }),
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
      const info = app.db
        .prepare(
          'insert into products (sku, name, price_cents, stock, created_at) values (?, ?, ?, ?, ?)',
        )
        .run(b.sku, b.name, b.price_cents, b.stock, new Date().toISOString());
      return reply.code(201).send(get(Number(info.lastInsertRowid))!);
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
      const set = Object.keys(data)
        .map((k) => `${k} = @${k}`)
        .join(', ');
      const info = app.db
        .prepare(`update products set ${set} where id = @id`)
        .run({ ...data, id: request.params.id });
      if (info.changes === 0) return reply.code(404).send({ error: 'not_found' });
      return get(request.params.id)!;
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
      const info = app.db.prepare('delete from products where id = ?').run(request.params.id);
      if (info.changes === 0) return reply.code(404).send({ error: 'not_found' });
      return reply.code(204).send(null);
    },
  );
};

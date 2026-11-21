import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from './common.ts';

const KEEP = 1000;

const report = z.object({
  remote: z.string().min(1).max(40),
  build: z.string().min(1).max(80),
  kind: z.enum(['render', 'load', 'unhandled']),
  message: z.string(),
  stack: z.string().optional(),
  url: z.string().max(500),
});

const row = report.extend({ id: z.number().int(), stack: z.string().nullable(), at: z.string() });

export const errorRoutes: FastifyPluginAsyncZod = async (app) => {
  // Public on purpose: a broken page may have no valid token. sendBeacon sends application/json.
  app.post(
    '/errors',
    {
      schema: {
        tags: ['errors'],
        body: report,
        response: { 201: z.object({ id: z.number().int() }), ...errors(400) },
      },
    },
    async (request, reply) => {
      const b = request.body;
      const [row] = await app.db.query<{ id: number }>(
        'insert into errors (remote, build, kind, message, stack, url, at) values ($1, $2, $3, $4, $5, $6, $7) returning id',
        [
          b.remote,
          b.build,
          b.kind,
          b.message.slice(0, 500),
          b.stack?.slice(0, 4000) ?? null,
          b.url,
          new Date().toISOString(),
        ],
      );
      await app.db.query(
        'delete from errors where id not in (select id from errors order by id desc limit $1)',
        [KEEP],
      );
      return reply.code(201).send({ id: row!.id });
    },
  );

  app.get(
    '/errors',
    {
      onRequest: app.requireRole('admin'),
      schema: {
        tags: ['errors'],
        querystring: z.object({ remote: z.string().optional() }),
        response: { 200: z.array(row), ...errors(400, 401, 403) },
      },
    },
    async (request) => {
      const { remote } = request.query;
      const sql = `select id, remote, build, kind, message, stack, url, at from errors ${
        remote === undefined ? '' : 'where remote = $1'
      } order by id desc limit 50`;
      return app.db.query<z.infer<typeof row>>(sql, remote === undefined ? [] : [remote]);
    },
  );

  app.get(
    '/errors/summary',
    {
      onRequest: app.requireRole('admin'),
      schema: {
        tags: ['errors'],
        response: {
          200: z.array(z.object({ remote: z.string(), count: z.number().int() })),
          ...errors(401, 403),
        },
      },
    },
    async () =>
      app.db.query<{ remote: string; count: number }>(
        'select remote, count(*)::int as count from errors group by remote order by remote',
      ),
  );

  app.delete(
    '/errors',
    {
      onRequest: app.requireRole('admin'),
      schema: { tags: ['errors'], response: { 204: z.null(), ...errors(401, 403) } },
    },
    async (_request, reply) => {
      await app.db.query('delete from errors');
      return reply.code(204).send(null);
    },
  );
};

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from './common.ts';

const flag = z.object({ name: z.string(), enabled: z.boolean(), description: z.string() });

type Row = { name: string; enabled: number; description: string };
const toFlag = (r: Row) => ({ ...r, enabled: r.enabled === 1 });

export const flagRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/flags',
    {
      onRequest: app.authenticate,
      schema: { tags: ['flags'], response: { 200: z.array(flag), ...errors(401) } },
    },
    async () =>
      (
        app.db.prepare('select name, enabled, description from flags order by name').all() as Row[]
      ).map(toFlag),
  );

  app.patch(
    '/flags/:name',
    {
      onRequest: app.requireRole('admin'),
      schema: {
        tags: ['flags'],
        params: z.object({ name: z.string() }),
        body: z.strictObject({ enabled: z.boolean() }),
        response: { 200: flag, ...errors(400, 401, 403, 404) },
      },
    },
    async (request, reply) => {
      const { name } = request.params;
      const info = app.db
        .prepare('update flags set enabled = ? where name = ?')
        .run(request.body.enabled ? 1 : 0, name);
      if (info.changes === 0) return reply.code(404).send({ error: 'not_found' });
      return toFlag(
        app.db
          .prepare('select name, enabled, description from flags where name = ?')
          .get(name) as Row,
      );
    },
  );
};

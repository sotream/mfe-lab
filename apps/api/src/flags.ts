import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from './common.ts';

const flag = z.object({ name: z.string(), enabled: z.boolean(), description: z.string() });

export const flagRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/flags',
    {
      onRequest: app.authenticate,
      schema: { tags: ['flags'], response: { 200: z.array(flag), ...errors(401) } },
    },
    async () =>
      app.db.query<z.infer<typeof flag>>(
        'select name, enabled, description from flags order by name',
      ),
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
      const [row] = await app.db.query<z.infer<typeof flag>>(
        'update flags set enabled = $1 where name = $2 returning name, enabled, description',
        [request.body.enabled, name],
      );
      return row ?? reply.code(404).send({ error: 'not_found' });
    },
  );
};

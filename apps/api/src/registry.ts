import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from './common.ts';

const row = z.object({
  name: z.string(),
  canaryUrl: z.string().nullable(),
  canaryPercent: z.number().int(),
  disabled: z.boolean(),
});

// https anywhere, or http on localhost with an explicit port (the local e2e releases); a manifest path only.
function isManifestUrl(value: string): boolean {
  const u = URL.canParse(value) ? new URL(value) : null;
  if (!u || !u.pathname.endsWith('/mf-manifest.json')) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname) && u.port !== '';
}

const patch = z.strictObject({
  canaryUrl: z.string().refine(isManifestUrl, 'invalid canary url').nullable().optional(),
  canaryPercent: z.number().int().min(0).max(100).optional(),
  disabled: z.boolean().optional(),
});

const returning =
  'returning name, canary_url as "canaryUrl", canary_percent as "canaryPercent", disabled';

export const registryRoutes: FastifyPluginAsyncZod = async (app) => {
  // Public: the shell reads it at boot, before login (RFC 0017).
  app.get(
    '/registry',
    { schema: { tags: ['registry'], security: [], response: { 200: z.array(row) } } },
    async (_request, reply) => {
      reply.header('cache-control', 'no-store');
      return app.db.query<z.infer<typeof row>>(
        'select name, canary_url as "canaryUrl", canary_percent as "canaryPercent", disabled from remotes order by name',
      );
    },
  );

  app.patch(
    '/registry/:name',
    {
      onRequest: app.requireRole('admin'),
      schema: {
        tags: ['registry'],
        params: z.object({ name: z.string() }),
        body: patch,
        response: { 200: row, ...errors(400, 401, 403, 404) },
      },
    },
    async (request, reply) => {
      const { canaryUrl, canaryPercent, disabled } = request.body;
      const [found] = await app.db.query<z.infer<typeof row>>(
        `update remotes set
           canary_url = case when $1::boolean then $2::text else canary_url end,
           canary_percent = coalesce($3::integer, canary_percent),
           disabled = coalesce($4::boolean, disabled),
           updated_at = now()
         where name = $5 ${returning}`,
        [
          canaryUrl !== undefined,
          canaryUrl ?? null,
          canaryPercent ?? null,
          disabled ?? null,
          request.params.name,
        ],
      );
      return found ?? reply.code(404).send({ error: 'not_found' });
    },
  );
};

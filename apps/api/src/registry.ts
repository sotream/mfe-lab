import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { isAllowedCanary } from '../../../deploy/canary.ts';
import { errors } from './common.ts';

const row = z.object({
  name: z.string(),
  canaryUrl: z.string().nullable(),
  canaryPercent: z.number().int(),
  disabled: z.boolean(),
});

// Allowlisted origins only (deploy/canary.ts); localhost outside production. Checked in the handler
// so the response code is invalid_canary_url, not the generic invalid_body.
const isManifestUrl = (value: string) =>
  isAllowedCanary(
    value,
    process.env.NODE_ENV !== 'production',
    process.env.VERCEL_ENV === 'production',
  );

const patch = z.strictObject({
  canaryUrl: z.string().nullable().optional(),
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
    async (request, reply) => {
      // Anonymous reads may sit in the CDN for ~a minute (RFC 0017). Vercel never caches a request that
      // carries Authorization, so a signed-in admin always reads fresh and no Vary is needed.
      reply.header(
        'cache-control',
        request.headers.authorization
          ? 'no-store'
          : 'public, s-maxage=5, stale-while-revalidate=60',
      );
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
      if (canaryUrl && !isManifestUrl(canaryUrl)) {
        return reply.code(400).send({ error: 'invalid_canary_url' });
      }
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

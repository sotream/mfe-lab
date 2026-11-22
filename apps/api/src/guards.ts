import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from './auth.ts';

// The public demo admin is read-only on the live site only. Previews, dev and tests stay unlocked
// (VERCEL_ENV is "preview" there, unset locally). DEMO_LOCK=1 forces it on for local checks.
export const demoLocked = () =>
  process.env.VERCEL_ENV === 'production' || process.env.DEMO_LOCK === '1';

// Every role except the owner account is "demo" while locked; viewers cannot write anyway.
export const isDemo = (role: Role) => demoLocked() && (role === 'admin' || role === 'editor');

// The single list of destructive routes (affect every visitor). While locked, only the owner
// account passes them; everyone else gets 403 demo_read_only. Keys are "METHOD route-url".
export const DESTRUCTIVE = [
  'PATCH /registry/:name',
  'PATCH /flags/:name',
  'DELETE /errors',
  'POST /orders',
  'PATCH /orders/:id',
  'DELETE /products/:id',
];

// Runs after the route's own requireRole, so request.user is set.
const demoGuard = async (request: FastifyRequest, reply: FastifyReply) => {
  if (isDemo(request.user.role)) return reply.code(403).send({ error: 'demo_read_only' });
};

const WRITE_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'];

// Must be registered before the routes: onRoute only sees routes defined after it.
// ponytail: rate-limit state is in memory per serverless instance, so the effective limit is
// per warm instance, not global. Move to a shared store (Redis/Postgres) if that matters.
export async function registerGuards(app: FastifyInstance) {
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) {
      const key = `${method} ${route.url}`;
      if (DESTRUCTIVE.includes(key)) {
        route.onRequest = [route.onRequest ?? []].flat().concat(demoGuard) as never;
      }
      // Authenticated writes: 60/min per user. Login and POST /errors set their own (per IP).
      if (WRITE_METHODS.includes(method) && !route.config?.rateLimit) {
        route.config = {
          ...route.config,
          rateLimit: {
            max: 60,
            timeWindow: '1 minute',
            keyGenerator: (r: FastifyRequest) => `u${r.user?.sub ?? r.ip}`,
          },
        };
      }
    }
  });
  // RATE_LIMIT=off is for the e2e API only (one IP logs in far more than 10 times a minute).
  // Never honoured on the live deployment.
  if (process.env.RATE_LIMIT === 'off') {
    if (process.env.VERCEL_ENV !== 'production') return;
    app.log.warn('RATE_LIMIT=off ignored in production');
  }
  // preHandler: runs after the route's authentication, so the key can be the user id.
  await app.register(rateLimit, { global: false, hook: 'preHandler' });
}

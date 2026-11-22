import swagger from '@fastify/swagger';
import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { registerAuth } from './auth.ts';
import { migrate, openDb, type Db } from './db.ts';
import { registerErrorHandler } from './errors.ts';
import { registerGuards } from './guards.ts';
import { flagRoutes } from './flags.ts';
import { orderRoutes } from './orders.ts';
import { productRoutes } from './products.ts';
import { registryRoutes } from './registry.ts';
import { seed } from './seed.ts';
import { statsRoutes } from './stats.ts';
import { errorRoutes } from './telemetry.ts';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
  }
}

// Non-secret id of the database host (first 12 hex of sha256), so a deploy can prove which database it uses.
// Same function as dbFingerprint in scripts/provision.ts (the API cannot import from scripts/).
const dbId = (url: string) => {
  const host = URL.canParse(url) ? new URL(url).hostname : '';
  // pglite:... has no host
  return host ? createHash('sha256').update(host).digest('hex').slice(0, 12) : 'local';
};

export async function buildApp(opts: {
  dbUrl: string;
  logger?: boolean;
  jwtSecret?: string;
  migrate?: boolean;
  docs?: boolean; // Swagger UI at /docs; default on
  db?: Db; // share an already open db (tests); the caller closes it
}): Promise<FastifyInstance> {
  // Vercel overwrites x-forwarded-for with the real client IP, so it is safe to trust there (rate
  // limits and the IP allowlist key on request.ip). Elsewhere the header would be client-controlled.
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: Boolean(process.env.VERCEL) });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'not_found' }));
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    // Authenticated responses are per-user: never cached by a shared cache or the browser.
    if (request.headers.authorization && !reply.hasHeader('cache-control')) {
      reply.header('cache-control', 'no-store');
    }
  });

  const db = opts.db ?? (await openDb(opts.dbUrl));
  if (opts.migrate ?? process.env.NODE_ENV !== 'production') await migrate(db);
  app.decorate('db', db);
  if (!opts.db) app.addHook('onClose', () => db.close());

  app.get('/health', async () => {
    await db.query('select 1');
    return { status: 'ok', db: dbId(opts.dbUrl) };
  });

  // Vercel Cron daily demo reset. Off (404) unless CRON_SECRET is set; hidden from Swagger.
  app.get('/cron/reseed', { schema: { hide: true } }, async (request, reply) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) return reply.code(404).send({ error: 'not_found' });
    const given = Buffer.from(request.headers.authorization ?? '');
    const want = Buffer.from(`Bearer ${secret}`);
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      // Lengths and presence only, never any part of either secret.
      const ua = request.headers['user-agent'];
      app.log.warn(
        {
          hasHeader: Boolean(request.headers.authorization),
          startsWithBearer: (request.headers.authorization ?? '').startsWith('Bearer '),
          givenLength: given.length,
          expectedLength: want.length,
          userAgent: typeof ua === 'string' ? ua.slice(0, 60) : undefined,
          hasVercelCronSchedule: 'x-vercel-cron-schedule' in request.headers,
          hasVercelCron: 'x-vercel-cron' in request.headers,
        },
        'cron reseed unauthorized',
      );
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const { users, products, orders } = await seed(db, { reset: true });
    return { reseeded: true, users, products, orders };
  });

  // Swagger must be registered before the routes it documents. /docs stays public.
  await app.register(swagger, {
    openapi: {
      info: { title: 'mfe-lab API', version: '0.0.0' },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
      security: [{ bearerAuth: [] }],
    },
    transform: jsonSchemaTransform,
  });
  if (opts.docs ?? true) {
    // Dynamic: @fastify/static needs require(esm), which the Vercel function loader lacks.
    const { default: swaggerUi } = await import('@fastify/swagger-ui');
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  await registerGuards(app, db, opts.jwtSecret || process.env.JWT_SECRET || '');
  await registerAuth(app, { jwtSecret: opts.jwtSecret });
  await app.register(productRoutes);
  await app.register(orderRoutes);
  await app.register(statsRoutes);
  await app.register(flagRoutes);
  await app.register(registryRoutes);
  await app.register(errorRoutes);

  return app;
}

import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { registerAuth } from './auth.ts';
import { migrate, openDb, type Database } from './db.ts';
import { registerErrorHandler } from './errors.ts';
import { orderRoutes } from './orders.ts';
import { productRoutes } from './products.ts';
import { statsRoutes } from './stats.ts';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

export async function buildApp(opts: {
  dbPath: string;
  logger?: boolean;
  jwtSecret?: string;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);

  const db = openDb(opts.dbPath);
  migrate(db);
  app.decorate('db', db);
  app.addHook('onClose', () => {
    db.close();
  });

  app.get('/health', () => {
    db.prepare('select 1').get();
    return { status: 'ok' };
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
  await app.register(swaggerUi, { routePrefix: '/docs' });

  await registerAuth(app, { jwtSecret: opts.jwtSecret });
  await app.register(productRoutes);
  await app.register(orderRoutes);
  await app.register(statsRoutes);

  return app;
}

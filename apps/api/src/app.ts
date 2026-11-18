import Fastify, { type FastifyInstance } from 'fastify';
import { migrate, openDb, type Database } from './db.ts';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

export async function buildApp(opts: {
  dbPath: string;
  logger?: boolean;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
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

  return app;
}

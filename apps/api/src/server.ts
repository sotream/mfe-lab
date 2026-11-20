import { buildApp } from './app.ts';
import { dbPathFromEnv } from './db.ts';

const app = await buildApp({ dbPath: dbPathFromEnv(), logger: true });
await app.listen({ port: Number(process.env.PORT ?? 4000), host: process.env.HOST ?? '127.0.0.1' });

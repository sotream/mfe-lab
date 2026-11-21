import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from './app.ts';
import { dbUrlFromEnv } from './db.ts';

// Vercel Function entry (bundled to api/index.js by `pnpm build`). No listen():
// the request goes straight to Fastify's http server. One app per warm instance.
const app = buildApp({ dbUrl: dbUrlFromEnv(), logger: true, migrate: false, docs: false });

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const instance = await app;
  await instance.ready();
  instance.server.emit('request', req, res);
}

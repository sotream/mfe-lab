// Helpers for the Vercel function entry tests (Q-function-entry, Q-no-pglite-in-prod).
// The entry is src/vercel.ts (bundled to api/index.js by `pnpm build`): a Node (req, res) handler.
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const apiDir = resolve(import.meta.dirname, '..');
export const entryPath = join(apiDir, 'src/vercel.ts');

type Inject = (d: unknown, o: object) => Promise<{ statusCode: number; body: string }>;

// Import the entry fresh, then send one request without listening on a port.
export async function invoke(
  url: string,
  init: { method?: string; payload?: object } = {},
): Promise<{ statusCode: number; body: string }> {
  const handler = (await import(entryPath)).default;
  if (typeof handler !== 'function') throw new Error('entry default export is not a function');
  // light-my-request (Fastify's own dependency) fakes req/res for a Node handler.
  const fastifyPath = createRequire(join(apiDir, 'package.json')).resolve('fastify');
  const inject = createRequire(fastifyPath)('light-my-request') as Inject;
  const r = await inject(handler, { method: init.method ?? 'GET', url, payload: init.payload });
  return { statusCode: r.statusCode, body: r.body };
}

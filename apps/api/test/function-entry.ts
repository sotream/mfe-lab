/* eslint-disable @typescript-eslint/no-explicit-any */
// Helpers for the Vercel function entry tests (Q-function-entry, Q-no-pglite-in-prod).
// PHASE 2: the entry path and handler signature are chosen by the builder; adjust here only.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const apiDir = resolve(import.meta.dirname, '..');
const readJson = (f: string) =>
  existsSync(join(apiDir, f)) ? (JSON.parse(readFileSync(join(apiDir, f), 'utf8')) as any) : {};

// Entry lookup: first `functions` key of vercel.json, then package.json "main", then Vercel's
// conventional api/ names. ponytail: guess list, phase 2 pins the real path.
export const entryPath = (): string => {
  const fns = Object.keys(readJson('vercel.json').functions ?? {});
  const pkgMain = readJson('package.json').main as string | undefined;
  const candidates = [
    'src/vercel.ts', // builder's choice: Node (req, res) handler, bundled to api/index.js
    ...fns,
    ...(pkgMain ? [pkgMain] : []),
    'api/index.ts',
    'api/[...path].ts',
    'api/[[...path]].ts',
    'api/index.js',
    'index.ts',
  ];
  const found = candidates.find((c) => existsSync(join(apiDir, c)));
  if (!found) throw new Error(`no Vercel function entry found in apps/api (tried ${candidates})`);
  return join(apiDir, found);
};

// Import the entry fresh, then send one request without listening on a port. Supports the three
// handler shapes: a Fastify instance as default export, a Node (req, res) function, or { fetch }.
export async function invoke(
  url: string,
  init: { method?: string; payload?: object } = {},
): Promise<{ statusCode: number; body: string }> {
  const mod = await import(entryPath());
  const h = mod.default ?? mod.handler;
  const method = init.method ?? 'GET';
  if (typeof h?.inject === 'function') {
    await h.ready?.();
    const r = await h.inject({ method, url, payload: init.payload });
    return { statusCode: r.statusCode, body: r.body };
  }
  if (typeof h?.fetch === 'function') {
    const r: Response = await h.fetch(
      new Request(`http://localhost${url}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: init.payload ? JSON.stringify(init.payload) : undefined,
      }),
    );
    return { statusCode: r.status, body: await r.text() };
  }
  if (typeof h === 'function') {
    // light-my-request (Fastify's own dependency) fakes req/res for a Node handler.
    const fastifyPath = createRequire(join(apiDir, 'package.json')).resolve('fastify');
    const inject = createRequire(fastifyPath)('light-my-request') as (
      d: unknown,
      o: object,
    ) => Promise<{ statusCode: number; body: string }>;
    const r = await inject(h, { method, url, payload: init.payload });
    return { statusCode: r.statusCode, body: r.body };
  }
  throw new Error('entry default export is not a Fastify instance, Node handler or { fetch }');
}

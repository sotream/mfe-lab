// Q-vercel-config: committed vercel.json files match the generator and mirror docker/nginx.conf.template.
// ASSUMPTIONS (contract leaves open, phase 2 adjusts):
//  - deploy/urls.json maps shell|products|dashboard|api to a URL string (or an object with `url`);
//  - generator CLI: `node scripts/vercel-config.ts --out <dir>` writes <dir>/apps/<name>/vercel.json.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const apps = ['shell', 'products', 'dashboard', 'api'] as const;
const statics = ['shell', 'products', 'dashboard'] as const;

type Header = { source: string; headers: { key: string; value: string }[] };
type VercelJson = {
  rewrites?: { source: string; destination: string }[];
  headers?: Header[];
  build?: { env?: Record<string, string> };
  env?: Record<string, string>;
  outputDirectory?: string;
  installCommand?: string;
  buildCommand?: string;
};

const load = (base: string, app: string) =>
  JSON.parse(readFileSync(join(base, 'apps', app, 'vercel.json'), 'utf8')) as VercelJson;
const urls = JSON.parse(readFileSync(join(root, 'deploy/urls.json'), 'utf8')) as Record<
  string,
  string | { url: string }
>;
const url = (app: string): string => {
  const v = urls[app];
  return (typeof v === 'string' ? v : v!.url).replace(/\/$/, '');
};

// Vercel `source` is path-to-regexp; the patterns here are plain regex-compatible.
export const matches = (source: string, path: string) => new RegExp(`^${source}$`).test(path);
const headersFor = (cfg: VercelJson, path: string) =>
  Object.fromEntries(
    (cfg.headers ?? [])
      .filter((h) => matches(h.source, path))
      .flatMap((h) => h.headers.map((x) => [x.key.toLowerCase(), x.value])),
  );

const tmp = mkdtempSync(join(tmpdir(), 'mfe-vercel-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('vercel config', () => {
  it('Q-vercel-config: committed files equal the generator output', () => {
    execFileSync('node', ['scripts/vercel-config.ts', '--out', tmp], { cwd: root });
    for (const app of apps) {
      expect(load(root, app), app).toEqual(load(tmp, app));
    }
  });

  it('Q-vercel-config: static apps proxy /api and fall back to index.html', () => {
    for (const app of statics) {
      const r = load(root, app).rewrites ?? [];
      expect(r, app).toContainEqual({ source: '/api/:path*', destination: `${url('api')}/:path*` });
      expect(
        r.find((x) => x.destination === '/index.html'),
        app,
      ).toBeDefined();
      // The proxy must come before the SPA catch-all.
      expect(r.findIndex((x) => x.source === '/api/:path*')).toBeLessThan(
        r.findIndex((x) => x.destination === '/index.html'),
      );
    }
  });

  it('Q-vercel-config: builds run from the monorepo root with pnpm into dist', () => {
    for (const app of statics) {
      const c = load(root, app);
      expect(c.outputDirectory, app).toBe('dist');
      expect(c.installCommand, app).toMatch(/pnpm/);
      expect(c.buildCommand, app).toMatch(/pnpm/);
    }
  });

  it('Q-vercel-config: remotes send CORS *, manifest and remoteEntry are no-store', () => {
    for (const app of ['products', 'dashboard'] as const) {
      const c = load(root, app);
      for (const p of ['/mf-manifest.json', '/remoteEntry.js']) {
        expect(headersFor(c, p)['access-control-allow-origin'], `${app} ${p}`).toBe('*');
      }
    }
    for (const app of statics) {
      const c = load(root, app);
      for (const p of ['/mf-manifest.json', '/remoteEntry.js']) {
        expect(headersFor(c, p)['cache-control'], `${app} ${p}`).toBe('no-store');
      }
      expect(headersFor(c, '/index.html')['cache-control'], `${app} index`).not.toMatch(
        /immutable/,
      );
    }
  });

  it('Q-vercel-config: shell build.env points at the production remote manifests', () => {
    const c = load(root, 'shell');
    const env = { ...c.env, ...c.build?.env };
    expect(env.MF_PRODUCTS_URL).toBe(`${url('products')}/mf-manifest.json`);
    expect(env.MF_DASHBOARD_URL).toBe(`${url('dashboard')}/mf-manifest.json`);
  });

  it('Q-vercel-config: api vercel.json has the daily 03:00 UTC reseed cron', () => {
    const c = JSON.parse(readFileSync(join(root, 'apps/api/vercel.json'), 'utf8')) as {
      crons?: { path: string; schedule: string }[];
    };
    expect(c.crons).toEqual([{ path: '/cron/reseed', schedule: '0 3 * * *' }]);
  });
});

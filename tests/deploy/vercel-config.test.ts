// Q-vercel-config: committed vercel.json files match the generator and mirror docker/nginx.conf.template.
// ASSUMPTIONS (contract leaves open, phase 2 adjusts):
//  - deploy/urls.json maps shell|products|dashboard|orders|api to a URL string (or an object with `url`);
//  - generator CLI: `node scripts/vercel-config.ts <dir>` writes <dir>/apps/<name>/vercel.json.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToRegexp } from 'path-to-regexp';
import { afterAll, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const apps = ['shell', 'products', 'dashboard', 'orders', 'api'] as const;
const statics = ['shell', 'products', 'dashboard', 'orders'] as const;

type Header = { source: string; headers: { key: string; value: string }[] };
type VercelJson = {
  rewrites?: { source: string; destination: string }[];
  headers?: Header[];
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

// Vercel compiles `source` with path-to-regexp 6.1.0 (pinned by @vercel/routing-utils); do the same.
// A plain RegExp accepted a bare {16} that Vercel reads as a literal group.
export const matches = (source: string, path: string) => pathToRegexp(source).test(path);
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
    execFileSync('node', ['scripts/vercel-config.ts', tmp], { cwd: root });
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
    for (const app of ['products', 'dashboard', 'orders'] as const) {
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
      expect(headersFor(c, '/index.html')['cache-control'] ?? '', `${app} index`).not.toMatch(
        /immutable/,
      );
    }
  });

  it('Q-vercel-immutable: hashed js, css and woff2 are immutable; entry files are not', () => {
    const hashed = [
      '/main.0123456789abcdef.js',
      '/static/js/async/src_Page_tsx.0123456789abcdef.js',
      '/static/css/main.0123456789abcdef.css',
      '/0123456789abcdef.woff2',
    ];
    for (const app of statics) {
      const c = load(root, app);
      for (const p of hashed) {
        expect(headersFor(c, p)['cache-control'], `${app} ${p}`).toBe(
          'public, max-age=31536000, immutable',
        );
      }
      for (const p of ['/remoteEntry.js', '/mf-manifest.json']) {
        expect(headersFor(c, p)['cache-control'], `${app} ${p}`).toBe('no-store');
      }
      expect(headersFor(c, '/index.html')['cache-control'] ?? '', `${app} index`).not.toMatch(
        /immutable/,
      );
    }
  });

  it('Q-vercel-immutable: entry files never match the immutable rule; /api rewrite matches as in Vercel', () => {
    for (const app of statics) {
      const c = load(root, app);
      const rules = (c.headers ?? []).filter((h) =>
        h.headers.some((x) => /immutable/.test(x.value)),
      );
      expect(rules.length, app).toBeGreaterThan(0);
      for (const p of ['/remoteEntry.js', '/mf-manifest.json', '/index.html']) {
        expect(
          rules.some((h) => matches(h.source, p)),
          `${app} ${p}`,
        ).toBe(false);
      }
      const api = (c.rewrites ?? []).find((r) => r.source === '/api/:path*')!;
      expect(matches(api.source, '/api/products/1'), app).toBe(true);
    }
  });

  it('Q-no-build-env: the shell vercel.json has no build key (vercel build ignores it)', () => {
    expect(load(root, 'shell')).not.toHaveProperty('build');
  });

  it('Q-no-build-env: deploy.yml exports the remote manifests from urls.json and guards localhost', () => {
    const wf = readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8');
    expect(wf).toMatch(/MF_PRODUCTS_URL=.*deploy\/urls\.json.*\.products.*\/mf-manifest\.json/);
    expect(wf).toMatch(/MF_DASHBOARD_URL=.*deploy\/urls\.json.*\.dashboard.*\/mf-manifest\.json/);
    expect(wf).toMatch(/MF_ORDERS_URL=.*deploy\/urls\.json.*\.orders.*\/mf-manifest\.json/);
    expect(wf).toMatch(/grep -rl 'localhost:300'/);
  });

  it('Q-vercel-config: api vercel.json has the daily 03:00 UTC reseed cron', () => {
    const c = JSON.parse(readFileSync(join(root, 'apps/api/vercel.json'), 'utf8')) as {
      crons?: { path: string; schedule: string }[];
    };
    expect(c.crons).toEqual([{ path: '/cron/reseed', schedule: '0 3 * * *' }]);
  });
});

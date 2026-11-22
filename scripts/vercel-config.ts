// Generates apps/{shell,products,dashboard,orders,api}/vercel.json from deploy/urls.json.
// Usage: node scripts/vercel-config.ts [outDir]   (default: the repo root, files are committed)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const urls: Record<'shell' | 'products' | 'dashboard' | 'orders' | 'api', string> = JSON.parse(
  readFileSync(join(root, 'deploy/urls.json'), 'utf8'),
);
// PREVIEW_API_URL points the /api rewrite at a PR preview API (preview.yml); unset, the output is the committed one.
const apiUrl = process.env.PREVIEW_API_URL ?? urls.api;
const out = resolve(process.argv[2] ?? root);

const header = (source: string, key: string, value: string) => ({
  source,
  headers: [{ key, value }],
});

// Mirrors docker/nginx.conf.template: API proxy, SPA fallback, CORS for remotes, no-store entries.
function staticApp(name: 'shell' | 'products' | 'dashboard' | 'orders') {
  const remote = name !== 'shell';
  return {
    installCommand: `pnpm install --frozen-lockfile --filter @mfe/${name}...`,
    buildCommand: 'pnpm build',
    outputDirectory: 'dist',
    rewrites: [
      { source: '/api/:path*', destination: `${apiUrl}/:path*` },
      { source: '/(.*)', destination: '/index.html' },
    ],
    headers: [
      ...(remote ? [header('/(.*)', 'Access-Control-Allow-Origin', '*')] : []),
      header('/(mf-manifest\\.json|remoteEntry\\.js)', 'Cache-Control', 'no-store'),
      // Content-hashed assets (16 hex chars) never change. remoteEntry.js has no hash, so it never matches.
      // The whole pattern must sit inside one group: Vercel's path-to-regexp 6.1.0 reads a bare {16} as a literal group.
      header(
        '/((?:.*\\.)?[0-9a-f]{16}\\.(?:js|css|woff2))',
        'Cache-Control',
        'public, max-age=31536000, immutable',
      ),
    ],
  };
}

// The function is apps/api/api/index.js (built by `pnpm build`); every path goes to it.
const api = {
  framework: null,
  regions: ['fra1'], // next to the Neon database (aws-eu-central-1)
  installCommand: 'pnpm install --frozen-lockfile --filter @mfe/api...',
  buildCommand: 'pnpm build',
  outputDirectory: 'public',
  rewrites: [{ source: '/(.*)', destination: '/api' }],
  crons: [{ path: '/cron/reseed', schedule: '0 3 * * *' }],
};

const files = {
  shell: staticApp('shell'),
  products: staticApp('products'),
  dashboard: staticApp('dashboard'),
  orders: staticApp('orders'),
  api,
};
for (const [name, config] of Object.entries(files)) {
  const dir = join(out, 'apps', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'vercel.json'), JSON.stringify(config, null, 2) + '\n');
}

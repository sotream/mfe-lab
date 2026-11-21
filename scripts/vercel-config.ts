// Generates apps/{shell,products,dashboard,api}/vercel.json from deploy/urls.json.
// Usage: node scripts/vercel-config.ts [outDir]   (default: the repo root, files are committed)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const urls: Record<'shell' | 'products' | 'dashboard' | 'api', string> = JSON.parse(
  readFileSync(join(root, 'deploy/urls.json'), 'utf8'),
);
const out = resolve(process.argv[2] ?? root);

const header = (source: string, key: string, value: string) => ({
  source,
  headers: [{ key, value }],
});

// Mirrors docker/nginx.conf.template: API proxy, SPA fallback, CORS for remotes, no-store entries.
function staticApp(name: 'shell' | 'products' | 'dashboard') {
  const remote = name !== 'shell';
  return {
    installCommand: `pnpm install --frozen-lockfile --filter @mfe/${name}...`,
    buildCommand: 'pnpm build',
    outputDirectory: 'dist',
    ...(name === 'shell' && {
      build: {
        env: {
          MF_PRODUCTS_URL: `${urls.products}/mf-manifest.json`,
          MF_DASHBOARD_URL: `${urls.dashboard}/mf-manifest.json`,
        },
      },
    }),
    rewrites: [
      { source: '/api/:path*', destination: `${urls.api}/:path*` },
      { source: '/(.*)', destination: '/index.html' },
    ],
    headers: [
      ...(remote ? [header('/(.*)', 'Access-Control-Allow-Origin', '*')] : []),
      header('/(mf-manifest\\.json|remoteEntry\\.js)', 'Cache-Control', 'no-store'),
      // Only the fonts are content-hashed (16 hex chars); JS and CSS use stable chunk names.
      header('/([0-9a-f]{16}\\.woff2)', 'Cache-Control', 'public, max-age=31536000, immutable'),
    ],
  };
}

// The function is apps/api/api/index.js (built by `pnpm build`); every path goes to it.
const api = {
  framework: null,
  regions: ['fra1'], // next to the Neon database (aws-eu-central-1)
  installCommand: 'pnpm install --frozen-lockfile --filter @mfe/api...',
  buildCommand: 'pnpm build',
  rewrites: [{ source: '/(.*)', destination: '/api' }],
  crons: [{ path: '/cron/reseed', schedule: '0 3 * * *' }],
};

const files = {
  shell: staticApp('shell'),
  products: staticApp('products'),
  dashboard: staticApp('dashboard'),
  api,
};
for (const [name, config] of Object.entries(files)) {
  const dir = join(out, 'apps', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'vercel.json'), JSON.stringify(config, null, 2) + '\n');
}

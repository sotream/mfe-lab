// Black-box checks on `pnpm build` output. One file so builds never write dist/ concurrently;
// tests run in order: default build first, MF_PRODUCTS_URL override last, then the shell is rebuilt
// with defaults so dist/ is left in its normal state.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToRegexp } from 'path-to-regexp';
import { exposes } from '../../federation.contract.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const BUILD_TIMEOUT = 180_000;
const singletons = ['react', 'react-dom', 'react-router'];
const overrideUrl = 'http://products.example.test/mf-manifest.json';

// Default env: drop any MF_* override that might leak in from the caller's shell.
const defaultEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('MF_')),
);
const pnpm = (args: string[], env: NodeJS.ProcessEnv = defaultEnv) =>
  execFileSync('pnpm', args, { cwd: root, env, stdio: 'pipe', encoding: 'utf8' });
const buildShell = (env?: NodeJS.ProcessEnv) => pnpm(['--filter', '@mfe/shell', 'build'], env);

type Manifest = {
  name: string;
  exposes: { path: string }[];
  shared: { name: string; singleton?: boolean }[];
};
const manifest = (app: string): Manifest =>
  JSON.parse(readFileSync(join(root, 'apps', app, 'dist', 'mf-manifest.json'), 'utf8')) as Manifest;

const expectSingletons = (m: Manifest) => {
  for (const name of singletons) {
    expect(m.shared, `${m.name} shares ${name}`).toContainEqual(
      expect.objectContaining({ name, singleton: true }),
    );
  }
};

const shellJs = (): string => {
  const dist = join(root, 'apps', 'shell', 'dist');
  return readdirSync(dist, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(dist, f), 'utf8'))
    .join('\n');
};

describe('federation build', { timeout: BUILD_TIMEOUT }, () => {
  beforeAll(() => void pnpm(['build']), BUILD_TIMEOUT);
  afterAll(() => void buildShell(), BUILD_TIMEOUT);

  it('Q-manifest: remotes expose their page and share the three singletons', () => {
    for (const [app, path] of [
      ['products', './ProductsPage'],
      ['dashboard', './DashboardPage'],
    ] as const) {
      const m = manifest(app);
      expect(m.name).toBe(app);
      expect(m.exposes).toContainEqual(expect.objectContaining({ path }));
      expectSingletons(m);
    }
  });

  it('Q-contract-manifest: each remote manifest exposes exactly the contract names', () => {
    for (const [app, names] of Object.entries(exposes)) {
      const got = manifest(app)
        .exposes.map((e) => e.path)
        .sort();
      expect(got, app).toEqual(names.map((n) => `./${n}`).sort());
    }
  });

  it('Q-orders-manifest: orders exposes ./OrdersApp and shares auth-store but no react', () => {
    const m = manifest('orders');
    expect(m.name).toBe('orders');
    expect(m.exposes).toContainEqual(expect.objectContaining({ path: './OrdersApp' }));
    expect(m.shared.map((s) => s.name).filter((n) => /^react/.test(n))).toEqual([]);
  });

  it('Q-no-react-in-orders: no react-dom or jsx-runtime code in apps/orders/dist', () => {
    const dist = join(root, 'apps', 'orders', 'dist');
    const js = readdirSync(dist, { recursive: true, encoding: 'utf8' }).filter((f) =>
      f.endsWith('.js'),
    );
    expect(js.length).toBeGreaterThan(0);
    for (const f of js) {
      const t = readFileSync(join(dist, f), 'utf8');
      expect(t, f).not.toMatch(/react-dom/);
      expect(t, f).not.toMatch(/react\/jsx-(dev-)?runtime/);
      // react-dom's and react's own markers, in case names were minified away
      expect(t, f).not.toMatch(/__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED/);
      expect(t, f).not.toMatch(/react\.element|react\.transitional\.element/);
    }
  });

  it('Q-shell-build: shell has index.html and a manifest with the singletons', () => {
    expect(existsSync(join(root, 'apps', 'shell', 'dist', 'index.html'))).toBe(true);
    expectSingletons(manifest('shell'));
  });

  it('Q-cache-hashed: the immutable header only matches content-hashed files in each dist', () => {
    // Pattern comes from each app's vercel.json (Vercel `source`, compiled with path-to-regexp 6.1.0 like Vercel does); built in
    // the shared beforeAll build so dist/ is never built twice.
    for (const app of ['shell', 'products', 'dashboard', 'orders']) {
      const cfg = JSON.parse(readFileSync(join(root, 'apps', app, 'vercel.json'), 'utf8')) as {
        headers: { source: string; headers: { key: string; value: string }[] }[];
      };
      const immutable = cfg.headers
        .filter((h) => h.headers.some((x) => /immutable/.test(x.value)))
        .map((h) => pathToRegexp(h.source));
      expect(immutable.length, `${app} has an immutable rule`).toBeGreaterThan(0);
      const dist = join(root, 'apps', app, 'dist');
      const files = readdirSync(dist, { recursive: true, encoding: 'utf8' }).filter((f) =>
        statSync(join(dist, f)).isFile(),
      );
      const hit = files.filter((f) => immutable.some((re) => re.test(`/${f}`)));
      expect(hit.length, `${app} has hashed files`).toBeGreaterThan(0);
      for (const f of hit) {
        expect(basename(f), `${app} ${f}`).toMatch(/[0-9a-f]{8,}/);
      }
      // Every hashed js, css and woff2 is immutable; entry files never are.
      const hashed = files.filter(
        (f) =>
          /\.(js|css|woff2)$/.test(f) &&
          /[0-9a-f]{16}/.test(basename(f)) &&
          basename(f) !== 'remoteEntry.js',
      );
      expect(hashed.length, `${app} hashed js/css/woff2`).toBeGreaterThan(0);
      for (const f of hashed) expect(hit, `${app} ${f} must be immutable`).toContain(f);
      for (const f of files.filter((f) =>
        /^(index\.html|mf-manifest\.json|remoteEntry\.js)$/.test(basename(f)),
      )) {
        expect(hit, `${app} ${f} must not be immutable`).not.toContain(f);
      }
    }
  });

  it('Q-icons: every app ships the favicons and links them from index.html', () => {
    for (const app of ['shell', 'products', 'dashboard', 'orders']) {
      const dist = join(root, 'apps', app, 'dist');
      for (const f of ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png']) {
        expect(existsSync(join(dist, f)), `${app} dist/${f}`).toBe(true);
      }
      const html = readFileSync(join(dist, 'index.html'), 'utf8');
      expect(html, app).toMatch(/<link[^>]*rel="icon"[^>]*href="\/favicon\.svg"/);
      expect(html, app).toMatch(/<link[^>]*rel="icon"[^>]*href="\/favicon-32\.png"/);
      expect(html, app).toMatch(
        /<link[^>]*rel="apple-touch-icon"[^>]*href="\/apple-touch-icon\.png"/,
      );
    }
  });

  it('Q-hashed-assets: every js and css except remoteEntry.js has a 16-hex hash; entry files stay unhashed', () => {
    const hash = /[0-9a-f]{16}/;
    for (const app of ['shell', 'products', 'dashboard', 'orders']) {
      const dist = join(root, 'apps', app, 'dist');
      const files = readdirSync(dist, { recursive: true, encoding: 'utf8' }).filter((f) =>
        statSync(join(dist, f)).isFile(),
      );
      const assets = files.filter((f) => /\.(js|css)$/.test(f) && basename(f) !== 'remoteEntry.js');
      expect(assets.length, `${app} has js/css`).toBeGreaterThan(0);
      for (const f of assets) expect(basename(f), `${app} ${f}`).toMatch(hash);
      // The shell is a host: no remoteEntry.js.
      if (app !== 'shell') {
        expect(existsSync(join(dist, 'remoteEntry.js')), `${app} remoteEntry.js`).toBe(true);
      }
      expect(existsSync(join(dist, 'mf-manifest.json')), `${app} mf-manifest.json`).toBe(true);
      expect(existsSync(join(dist, 'index.html')), `${app} index.html`).toBe(true);
    }
    const html = readFileSync(join(root, 'apps', 'shell', 'dist', 'index.html'), 'utf8');
    const refs = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))(?:\?[^"']*)?["']/g)].map(
      (m) => m[1]!,
    );
    expect(refs.length, 'index.html references scripts/styles').toBeGreaterThan(0);
    for (const r of refs) expect(basename(r), `index.html -> ${r}`).toMatch(hash);
  });

  // Q-size-budget: `--budget <file>` overrides perf-budget.json; violations name the app and metric on stdout/stderr.
  const apps = ['shell', 'products', 'dashboard', 'orders'] as const;
  const metrics = ['initialJsGzip', 'totalJsGzip', 'cssGzip'] as const;
  const sizeBudget = (args: string[] = []) =>
    spawnSync('node', ['scripts/size-budget.ts', ...args], { cwd: root, encoding: 'utf8' });
  const out = (r: { stdout: string; stderr: string }) => r.stdout + r.stderr;

  it('Q-size-budget: exits 0 on the real build and prints every metric for every app', () => {
    const r = sizeBudget();
    expect(r.status, out(r)).toBe(0);
    for (const app of apps) for (const m of metrics) expect(out(r), `${app} ${m}`).toContain(m);
    for (const app of apps) expect(out(r)).toContain(app);
  });

  it('Q-size-budget: exits 1 and names the metric when a budget is below the actual size', () => {
    const real = JSON.parse(readFileSync(join(root, 'perf-budget.json'), 'utf8')) as Record<
      string,
      Record<string, number>
    >;
    const dir = mkdtempSync(join(tmpdir(), 'mfe-budget-'));
    try {
      for (const m of metrics) {
        const lowered = structuredClone(real);
        lowered['shell']![m] = 1;
        const file = join(dir, `${m}.json`);
        writeFileSync(file, JSON.stringify(lowered));
        const r = sizeBudget(['--budget', file]);
        expect(r.status, `${m}: ${out(r)}`).toBe(1);
        expect(out(r), m).toContain(m);
        expect(out(r), m).toContain('shell');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Q-api-bundle: pnpm build emits the Vercel function with PGlite only as a dynamic import', () => {
    const js = readFileSync(join(root, 'apps', 'api', 'api', 'index.js'), 'utf8');
    expect(js).toContain('import("@electric-sql/pglite")');
    expect(js).not.toMatch(/(from|import)\s*["']@electric-sql\/pglite["']/);
  });

  it('Q-remotes-env: default remote URLs, then MF_PRODUCTS_URL override', () => {
    const js = shellJs();
    expect(js).toContain('http://localhost:3001/mf-manifest.json');
    expect(js).toContain('http://localhost:3002/mf-manifest.json');
    expect(js).toContain('http://localhost:3003/mf-manifest.json');

    buildShell({ ...defaultEnv, MF_PRODUCTS_URL: overrideUrl });
    const overridden = shellJs();
    expect(overridden).toContain(overrideUrl);
    expect(overridden).not.toContain('localhost:3001/mf-manifest.json');
  });

  it('Q-manifest-auth-store: shell and all remotes share @mfe/auth-store as a singleton', () => {
    for (const app of ['shell', 'products', 'dashboard', 'orders']) {
      expect(manifest(app).shared, app).toContainEqual(
        expect.objectContaining({ name: '@mfe/auth-store', singleton: true }),
      );
    }
  });

  it('Q-root-typecheck: pnpm typecheck exits 0 (includes root tests/**)', () => {
    expect(() => pnpm(['typecheck'])).not.toThrow();
  });
});

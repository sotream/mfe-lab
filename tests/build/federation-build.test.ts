// Black-box checks on `pnpm build` output. One file so builds never write dist/ concurrently;
// tests run in order: default build first, MF_PRODUCTS_URL override last, then the shell is rebuilt
// with defaults so dist/ is left in its normal state.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

  it('Q-shell-build: shell has index.html and a manifest with the singletons', () => {
    expect(existsSync(join(root, 'apps', 'shell', 'dist', 'index.html'))).toBe(true);
    expectSingletons(manifest('shell'));
  });

  it('Q-remotes-env: default remote URLs, then MF_PRODUCTS_URL override', () => {
    const js = shellJs();
    expect(js).toContain('http://localhost:3001/mf-manifest.json');
    expect(js).toContain('http://localhost:3002/mf-manifest.json');

    buildShell({ ...defaultEnv, MF_PRODUCTS_URL: overrideUrl });
    const overridden = shellJs();
    expect(overridden).toContain(overrideUrl);
    expect(overridden).not.toContain('localhost:3001/mf-manifest.json');
  });

  it('Q-root-typecheck: pnpm typecheck exits 0 (includes root tests/**)', () => {
    expect(() => pnpm(['typecheck'])).not.toThrow();
  });
});

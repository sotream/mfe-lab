// Q-changed-apps: path -> apps mapping.
// changedApps(paths) returns app names in DEPLOY order: api, products, dashboard, orders, shell.
// Also a CLI: paths on stdin, one app per line on stdout.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { changedApps, previewNeeded } from '../../scripts/changed-apps.ts';

const all = ['api', 'products', 'dashboard', 'orders', 'shell'];

const cases: [string, string[], string[]][] = [
  ['shell source', ['apps/shell/src/App.tsx'], ['shell']],
  ['products source', ['apps/products/src/x.tsx'], ['products']],
  ['dashboard source', ['apps/dashboard/rspack.config.ts'], ['dashboard']],
  ['orders source', ['apps/orders/src/OrdersApp.ts'], ['orders']],
  ['orders vue file', ['apps/orders/src/Orders.vue'], ['orders']],
  ['api source', ['apps/api/src/server.ts'], ['api']],
  ['api migration', ['apps/api/migrations/003_x.sql'], ['api']],
  ['packages', ['packages/auth-store/src/index.ts'], all],
  ['federation.shared.ts', ['federation.shared.ts'], all],
  ['lockfile', ['pnpm-lock.yaml'], all],
  ['workspace file', ['pnpm-workspace.yaml'], all],
  ['root package.json', ['package.json'], all],
  ['deploy dir', ['deploy/urls.json'], all],
  ['vercel-config script', ['scripts/vercel-config.ts'], all],
  ['deploy workflow', ['.github/workflows/deploy.yml'], all],
  ['docs', ['docs/deploy.md', 'README.md'], []],
  ['tests', ['tests/deploy/x.test.ts'], []],
  ['e2e', ['e2e/login.spec.ts'], []],
  ['other workflows', ['.github/workflows/ci.yml', '.github/dependabot.yml'], []],
  ['empty input', [], []],
  ['two apps, deploy order', ['apps/shell/a.ts', 'apps/api/b.ts'], ['api', 'shell']],
  [
    'remotes, deploy order',
    ['apps/dashboard/a.ts', 'apps/products/b.ts'],
    ['products', 'dashboard'],
  ],
  [
    'orders joins the remotes, deploy order',
    ['apps/orders/a.ts', 'apps/dashboard/a.ts', 'apps/products/b.ts'],
    ['products', 'dashboard', 'orders'],
  ],
  ['orders then shell', ['apps/shell/a.ts', 'apps/orders/a.ts'], ['orders', 'shell']],
  [
    'all five apps, reverse input',
    ['apps/shell/a', 'apps/orders/a', 'apps/dashboard/a', 'apps/products/a', 'apps/api/a'],
    all,
  ],
  ['duplicates collapse', ['apps/shell/a.ts', 'apps/shell/b.ts'], ['shell']],
  ['app plus docs', ['apps/products/a.ts', 'docs/x.md'], ['products']],
  ['one app plus global wins', ['apps/shell/a.ts', 'packages/x/y.ts'], all],
  ['ignored plus global', ['docs/x.md', 'pnpm-lock.yaml'], all],
];

describe('changed-apps', () => {
  it.each(cases)('Q-changed-apps: %s', (_name, paths, expected) => {
    expect(changedApps(paths)).toEqual(expected);
  });

  it('Q-changed-apps: does not mutate its input', () => {
    const p = ['apps/shell/a.ts', 'apps/api/b.ts'];
    changedApps(p);
    expect(p).toEqual(['apps/shell/a.ts', 'apps/api/b.ts']);
  });

  it('Q-changed-apps: CLI reads paths on stdin, prints one app per line in deploy order', () => {
    const r = spawnSync('node', ['scripts/changed-apps.ts'], {
      cwd: resolve(import.meta.dirname, '../..'),
      input: 'apps/shell/a.ts\napps/dashboard/b.ts\ndocs/x.md\n',
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual(['dashboard', 'shell']);
  });

  it('Q-changed-apps: CLI prints nothing for docs-only changes', () => {
    const r = spawnSync('node', ['scripts/changed-apps.ts'], {
      cwd: resolve(import.meta.dirname, '../..'),
      input: 'docs/x.md\n',
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });
});

describe('previewNeeded', () => {
  it.each([
    ['docs only', ['docs/deploy.md', 'README.md']],
    ['tests only', ['tests/deploy/x.test.ts', 'apps/api/test/y.ts']],
    ['e2e only', ['e2e/home.spec.ts']],
    ['app test file', ['apps/products/test/x.test.tsx']],
    ['ci.yml only', ['.github/workflows/ci.yml']],
  ])('false for %s', (_n, files) => {
    expect(previewNeeded(files)).toBe(false);
  });

  it.each([
    ['app source', ['apps/products/src/x.tsx']],
    ['shared package', ['packages/ui/src/x.ts']],
    ['lockfile', ['pnpm-lock.yaml']],
    ['preview workflow', ['.github/workflows/preview.yml']],
    ['preview script', ['scripts/preview-comment.ts']],
    ['app change next to docs', ['docs/a.md', 'apps/shell/src/a.tsx']],
  ])('true for %s', (_n, files) => {
    expect(previewNeeded(files)).toBe(true);
  });

  it('CLI --preview-needed prints true or false', () => {
    const run = (input: string) =>
      spawnSync('node', ['scripts/changed-apps.ts', '--preview-needed'], {
        cwd: resolve(import.meta.dirname, '../..'),
        input,
        encoding: 'utf8',
      }).stdout.trim();
    expect(run('docs/x.md\n')).toBe('false');
    expect(run('apps/api/src/x.ts\n')).toBe('true');
  });
});

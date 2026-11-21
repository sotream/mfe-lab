// Q-changed-apps: path -> apps mapping.
// ASSUMPTION (phase 2 adjusts): scripts/changed-apps.ts exports `changedApps(paths: string[]): string[]`
// returning a sorted list of app names.
import { describe, expect, it } from 'vitest';
import { changedApps } from '../../scripts/changed-apps.ts';

const all = ['api', 'dashboard', 'products', 'shell'];

const cases: [string, string[], string[]][] = [
  ['shell source', ['apps/shell/src/App.tsx'], ['shell']],
  ['products source', ['apps/products/src/x.tsx'], ['products']],
  ['dashboard source', ['apps/dashboard/rspack.config.ts'], ['dashboard']],
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
  ['two apps, sorted', ['apps/shell/a.ts', 'apps/api/b.ts'], ['api', 'shell']],
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
});

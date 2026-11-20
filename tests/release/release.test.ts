// Black-box checks on `pnpm --filter @mfe/products release <v>`. Slow: each run is a full build.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const releases = join(root, 'apps', 'products', 'releases');
const indexPath = join(releases, 'index.json');
const V1 = '0.0.0-test.1';
const V2 = '0.0.0-test.2';
const TIMEOUT = 180_000;

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('MF_')));
const release = (v: string) =>
  execFileSync('pnpm', ['--filter', '@mfe/products', 'release', v], {
    cwd: root,
    env,
    stdio: 'pipe',
    encoding: 'utf8',
  });
const versions = (): string[] =>
  (JSON.parse(readFileSync(indexPath, 'utf8')) as { versions: string[] }).versions;

let savedIndex: string | null = null;

beforeAll(() => {
  savedIndex = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null;
});
afterAll(() => {
  for (const v of [V1, V2]) rmSync(join(releases, v), { recursive: true, force: true });
  if (savedIndex === null) rmSync(indexPath, { force: true });
  else writeFileSync(indexPath, savedIndex);
});

describe('release script', () => {
  it(
    'Q-release-script: builds a version, writes index.json, keeps versions sorted',
    () => {
      release(V1);
      const m = JSON.parse(readFileSync(join(releases, V1, 'mf-manifest.json'), 'utf8')) as {
        metaData: { buildInfo: { buildVersion: string } };
      };
      expect(m.metaData.buildInfo.buildVersion).toBe(V1);
      expect(existsSync(join(releases, V1, 'remoteEntry.js'))).toBe(true);
      expect(versions()).toContain(V1);

      release(V2);
      const all = versions();
      expect(all).toContain(V1);
      expect(all).toContain(V2);
      expect(all.indexOf(V1)).toBeLessThan(all.indexOf(V2));
      expect(new Set(all).size).toBe(all.length);
    },
    TIMEOUT * 2,
  );

  it('Q-release-script: invalid version exits with code 1', () => {
    const before = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null;
    let status: number | null = null;
    try {
      release('bad/version');
    } catch (e) {
      status = (e as { status: number }).status;
    }
    // pnpm may forward the script's exit code; any non-zero is a failure, the contract says 1.
    expect(status).toBe(1);
    expect(existsSync(join(releases, 'bad'))).toBe(false);
    expect(existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null).toBe(before);
  });
});

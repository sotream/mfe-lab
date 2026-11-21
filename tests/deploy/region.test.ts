// Q-region: the api functions run in fra1 and the committed file equals the generator output.
// ASSUMPTION: generator CLI `node scripts/vercel-config.ts <dir>` writes <dir>/apps/<name>/vercel.json (as in Q-vercel-config).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const tmp = mkdtempSync(join(tmpdir(), 'mfe-region-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const load = (base: string) =>
  JSON.parse(readFileSync(join(base, 'apps/api/vercel.json'), 'utf8')) as { regions?: string[] };

describe('api region', () => {
  it('Q-region: committed api vercel.json has regions ["fra1"]', () => {
    expect(load(root).regions).toEqual(['fra1']);
  });

  it('Q-region: the generator emits the same regions', () => {
    execFileSync('node', ['scripts/vercel-config.ts', tmp], { cwd: root });
    expect(load(tmp).regions).toEqual(['fra1']);
    expect(load(tmp)).toEqual(load(root));
  });
});

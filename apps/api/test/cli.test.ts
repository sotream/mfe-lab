import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { counts, tempDir } from './helpers.ts';

const root = resolve(import.meta.dirname, '../../..');
const dir = tempDir();

const pnpm = (script: string, dbPath: string) => {
  const r = spawnSync('pnpm', [script], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, DB_PATH: dbPath },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('cli', { timeout: 60_000 }, () => {
  it('Q-cli: seed, seed again (already seeded), seed:reset; file has 3/30/60', () => {
    const dbPath = join(dir, 'a.db');
    const first = pnpm('seed', dbPath);
    expect(first.status, first.out).toBe(0);
    const second = pnpm('seed', dbPath);
    expect(second.status, second.out).toBe(0);
    expect(second.out).toContain('already seeded');
    const reset = pnpm('seed:reset', dbPath);
    expect(reset.status, reset.out).toBe(0);

    const db = new Database(dbPath, { readonly: true });
    try {
      expect(counts(db)).toEqual({ users: 3, products: 30, orders: 60 });
    } finally {
      db.close();
    }
  });

  it('Q-cli-fresh-dir: seed creates missing parent directories', () => {
    const dbPath = join(dir, 'nested', 'deeper', 'a.db');
    const r = pnpm('seed', dbPath);
    expect(r.status, r.out).toBe(0);
    expect(existsSync(dbPath)).toBe(true);
  });
});

import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.ts';
import { counts, tempDir } from './helpers.ts';

const root = resolve(import.meta.dirname, '../../..');
const dir = tempDir();

const pnpm = (script: string, dbUrl: string) => {
  const r = spawnSync('pnpm', [script], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: dbUrl },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('cli', { timeout: 120_000 }, () => {
  it('Q-cli: seed, seed again (already seeded), seed:reset; data has 3/30/60', async () => {
    const dbUrl = `pglite:${join(dir, 'a')}`;
    const first = pnpm('seed', dbUrl);
    expect(first.status, first.out).toBe(0);
    const second = pnpm('seed', dbUrl);
    expect(second.status, second.out).toBe(0);
    expect(second.out).toContain('already seeded');
    const reset = pnpm('seed:reset', dbUrl);
    expect(reset.status, reset.out).toBe(0);

    const db = await openDb(dbUrl);
    try {
      expect(await counts(db)).toEqual({ users: 3, products: 30, orders: 60 });
      // Q-seed-reset through the CLI: ids restart at 1
      expect(await db.query('SELECT id, name FROM products WHERE sku = $1', ['SKU-0001'])).toEqual([
        { id: 1, name: 'Drucksensor' },
      ]);
    } finally {
      await db.close();
    }
  });

  it('Q-cli-fresh-dir: seed creates missing parent directories', async () => {
    const dbUrl = `pglite:${join(dir, 'nested', 'deeper', 'pg')}`;
    const r = pnpm('seed', dbUrl);
    expect(r.status, r.out).toBe(0);
    const db = await openDb(dbUrl);
    try {
      expect((await counts(db)).products).toBe(30);
    } finally {
      await db.close();
    }
  });
});

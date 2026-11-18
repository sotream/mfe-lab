import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { migrate, openDb } from '../src/db.ts';

export type Db = ReturnType<typeof openDb>;

export const freshDb = (): Db => {
  const db = openDb(':memory:');
  migrate(db);
  return db;
};

export const count = (db: Db, table: string): number =>
  (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

export const counts = (db: Db) => ({
  users: count(db, 'users'),
  products: count(db, 'products'),
  orders: count(db, 'orders'),
});

export const userVersion = (db: Db): number =>
  db.pragma('user_version', { simple: true }) as number;

// One temp dir per test file, removed after the file's tests.
export const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'mfe-api-test-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

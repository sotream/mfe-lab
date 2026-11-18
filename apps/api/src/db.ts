import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';

export type Database = BetterSqlite3.Database;

const apiDir = resolve(import.meta.dirname, '..');

// DB_PATH env wins; a relative path resolves against apps/api/.
export const dbPathFromEnv = (): string => resolve(apiDir, process.env.DB_PATH ?? 'data/app.db');

export function openDb(path: string): Database {
  const inMemory = path === ':memory:';
  if (!inMemory) mkdirSync(dirname(path), { recursive: true });
  const db = new BetterSqlite3(path);
  db.pragma('foreign_keys = ON');
  if (!inMemory) db.pragma('journal_mode = WAL');
  return db;
}

// Applies migrations/NNN_name.sql newer than PRAGMA user_version. Returns the new version.
export function migrate(db: Database): number {
  const dir = join(apiDir, 'migrations');
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();
  for (const file of files) {
    const version = parseInt(file, 10);
    if (version <= Number(db.pragma('user_version', { simple: true }))) continue;
    db.transaction(() => {
      db.exec(readFileSync(join(dir, file), 'utf8'));
      db.pragma(`user_version = ${version}`);
    })();
  }
  return Number(db.pragma('user_version', { simple: true }));
}

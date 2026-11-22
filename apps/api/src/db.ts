import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { isAllowedCanary } from '../../../deploy/canary.ts';

// The only DB API the rest of the code uses. Placeholders are $1..$n.
export type Db = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>; // multi-statement, no params
  tx<R>(fn: (db: Db) => Promise<R>): Promise<R>; // BEGIN/COMMIT, ROLLBACK on throw
  close(): Promise<void>;
};

const apiDir = resolve(import.meta.dirname, '..');

// DATABASE_URL wins; empty or unset means local file-backed PGlite under apps/api/data/pg.
export const dbUrlFromEnv = (): string => process.env.DATABASE_URL || 'pglite:./data/pg';

// OIDs: 20 int8 (count, sum), 1700 numeric, 1184 timestamptz. Keeps JSON shapes plain:
// numbers stay numbers, timestamps are ISO strings with milliseconds and Z.
const iso = (v: string) => new Date(v).toISOString();
const parsers = { 20: Number, 1700: Number, 1184: iso };
for (const [oid, fn] of Object.entries(parsers)) pg.types.setTypeParser(Number(oid), fn);

function wrapPglite(c: PGlite, close: () => Promise<void>): Db {
  const db: Db = {
    query: async (sql, params) => (await c.query(sql, params)).rows as never,
    exec: async (sql) => {
      await c.exec(sql);
    },
    tx: (fn) => c.transaction((t) => fn(wrapPglite(t as unknown as PGlite, async () => {}))),
    close,
  };
  return db;
}

function wrapPg(c: pg.Pool | pg.PoolClient, pool: pg.Pool): Db {
  return {
    query: async (sql, params) => (await c.query(sql, params)).rows,
    exec: async (sql) => {
      await c.query(sql);
    },
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const r = await fn(wrapPg(client, pool));
        await client.query('commit');
        return r;
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export async function openDb(url: string): Promise<Db> {
  if (/^postgres(ql)?:\/\//.test(url)) {
    // Small pool: on Vercel every warm instance holds its own, and Neon pools on its side.
    const pool = new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000 });
    return wrapPg(pool, pool);
  }
  // Dynamic import: the production (Vercel) path must never load PGlite.
  const { PGlite } = await import('@electric-sql/pglite');
  if (url === 'pglite:memory') {
    const c = new PGlite({ parsers });
    await c.waitReady;
    return wrapPglite(c, () => c.close());
  }
  if (url.startsWith('pglite:') && url.length > 'pglite:'.length) {
    const dir = resolve(apiDir, url.slice('pglite:'.length));
    mkdirSync(dir, { recursive: true });
    const c = new PGlite(dir, { parsers });
    await c.waitReady;
    return wrapPglite(c, () => c.close());
  }
  throw new Error(
    `unsupported database URL scheme (use postgres://, pglite:memory or pglite:<dir>)`,
  );
}

// Applies migrations/NNN_name.sql newer than the highest row in schema_migrations,
// each in one transaction. Returns the applied version.
export async function migrate(db: Db): Promise<number> {
  await db.exec(
    'create table if not exists schema_migrations (version integer primary key, applied_at timestamptz not null default now())',
  );
  const current = async () =>
    (
      await db.query<{ v: number }>('select coalesce(max(version), 0) as v from schema_migrations')
    )[0]!.v;
  const dir = join(apiDir, 'migrations');
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();
  const done = await current();
  for (const file of files) {
    const version = parseInt(file, 10);
    if (version <= done) continue;
    await db.tx(async (t) => {
      await t.exec(readFileSync(join(dir, file), 'utf8'));
      await t.query('insert into schema_migrations (version) values ($1)', [version]);
    });
  }
  // Rows written before the allowlist existed (T46): drop any canary that would not pass it now.
  const rows = await db.query<{ name: string; canary_url: string }>(
    'select name, canary_url from remotes where canary_url is not null',
  );
  for (const r of rows) {
    if (!isAllowedCanary(r.canary_url, process.env.NODE_ENV !== 'production')) {
      await db.query(
        'update remotes set canary_url = null, canary_percent = 0, updated_at = now() where name = $1',
        [r.name],
      );
    }
  }
  return current();
}

if (import.meta.main) {
  const db = await openDb(dbUrlFromEnv());
  console.log(`migrated to version ${await migrate(db)}`);
  await db.close();
}

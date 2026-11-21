import { afterEach, describe, expect, it, vi } from 'vitest';
import { dbUrlFromEnv, migrate, openDb } from '../src/db.ts';
import { freshDb, schemaVersions, tempDir, type Db } from './helpers.ts';

type Column = {
  column_name: string;
  data_type: string;
  is_nullable: string;
  is_identity: string;
  identity_generation: string | null;
};

// [name, information_schema data_type] per the Contract; every column is NOT NULL except
// errors.stack. `id` is `integer generated always as identity` (checked separately).
const schema: Record<string, [string, string][]> = {
  users: [
    ['email', 'text'],
    ['password_hash', 'text'],
    ['role', 'text'],
  ],
  products: [
    ['sku', 'text'],
    ['name', 'text'],
    ['price_cents', 'integer'],
    ['stock', 'integer'],
    ['created_at', 'timestamp with time zone'],
  ],
  orders: [
    ['product_id', 'integer'],
    ['qty', 'integer'],
    ['status', 'text'],
    ['created_at', 'timestamp with time zone'],
  ],
  errors: [
    ['remote', 'text'],
    ['build', 'text'],
    ['kind', 'text'],
    ['message', 'text'],
    ['url', 'text'],
    ['at', 'timestamp with time zone'],
  ],
};

const now = '2026-11-01T00:00:00.000Z';
const insertUser = (db: Db, email: string, role: string) =>
  db.query('INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)', [
    email,
    'h',
    role,
  ]);
const insertProduct = async (db: Db, sku: string, price: number, stock: number) =>
  (
    await db.query<{ id: number }>(
      'INSERT INTO products (sku, name, price_cents, stock, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [sku, 'n', price, stock, now],
    )
  )[0]!.id;
const insertOrder = (db: Db, productId: number, qty: number, status: string) =>
  db.query('INSERT INTO orders (product_id, qty, status, created_at) VALUES ($1, $2, $3, $4)', [
    productId,
    qty,
    status,
    now,
  ]);

describe('db', () => {
  it('Q-schema: tables, columns, PK, FK and schema_migrations match the Contract', async () => {
    const db = await freshDb();
    for (const [table, cols] of Object.entries(schema)) {
      const info = await db.query<Column>(
        `SELECT column_name, data_type, is_nullable, is_identity, identity_generation
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1`,
        [table],
      );
      const id = info.find((c) => c.column_name === 'id');
      expect(id, `${table}.id`).toMatchObject({
        data_type: 'integer',
        is_identity: 'YES',
        identity_generation: 'ALWAYS',
      });
      const rest = info.filter((c) => c.column_name !== 'id');
      expect(rest.map((c) => [c.column_name, c.data_type]).sort(), table).toEqual(
        [...cols, ...(table === 'errors' ? [['stack', 'text']] : [])].sort(),
      );
      for (const c of rest) {
        if (c.column_name !== 'stack')
          expect(c.is_nullable, `${table}.${c.column_name}`).toBe('NO');
      }
      const pk = await db.query(
        `SELECT 1 FROM information_schema.table_constraints
         WHERE table_schema = 'public' AND table_name = $1 AND constraint_type = 'PRIMARY KEY'`,
        [table],
      );
      expect(pk, `${table} primary key`).toHaveLength(1);
    }

    const flags = await db.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'flags'`,
    );
    expect(flags).toContainEqual({ column_name: 'enabled', data_type: 'boolean' });

    const fks = await db.query(
      `SELECT kcu.column_name AS "from", ccu.table_name AS "table", ccu.column_name AS "to"
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = 'orders'`,
    );
    expect(fks).toEqual([{ from: 'product_id', table: 'products', to: 'id' }]);

    const tracking = await db.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'schema_migrations'`,
    );
    expect(tracking.map((c) => [c.column_name, c.data_type]).sort()).toEqual([
      ['applied_at', 'timestamp with time zone'],
      ['version', 'integer'],
    ]);
    await db.close();
  });

  it('Q-constraints: CHECK, UNIQUE and FK violations throw with Postgres codes', async () => {
    const db = await freshDb();
    await insertUser(db, 'a@x.test', 'admin');
    const productId = await insertProduct(db, 'S-1', 100, 1);
    await insertOrder(db, productId, 1, 'new');

    const bad: [string, string, () => Promise<unknown>][] = [
      ['role root', '23514', () => insertUser(db, 'b@x.test', 'root')],
      ['duplicate email', '23505', () => insertUser(db, 'a@x.test', 'viewer')],
      ['duplicate sku', '23505', () => insertProduct(db, 'S-1', 100, 1)],
      ['price_cents -1', '23514', () => insertProduct(db, 'S-2', -1, 1)],
      ['stock -1', '23514', () => insertProduct(db, 'S-3', 100, -1)],
      ['qty 0', '23514', () => insertOrder(db, productId, 0, 'new')],
      ['status lost', '23514', () => insertOrder(db, productId, 1, 'lost')],
      ['missing product_id', '23503', () => insertOrder(db, 99_999, 1, 'new')],
    ];
    for (const [name, code, fn] of bad) await expect(fn(), name).rejects.toMatchObject({ code });
    await db.close();
  });

  it('Q-migrate: twice is idempotent, returns 3, schema_migrations has 3 rows', async () => {
    const db = await freshDb(); // freshDb already ran migrate once
    expect(await migrate(db)).toBe(3);
    expect(await migrate(db)).toBe(3);
    expect(await schemaVersions(db)).toEqual([1, 2, 3]);
    const rows = await db.query<{ n: number; applied: number }>(
      'SELECT count(*)::int AS n, count(applied_at)::int AS applied FROM schema_migrations',
    );
    expect(rows).toEqual([{ n: 3, applied: 3 }]);
    // seeded flags from 002 are not duplicated by re-running
    expect(await db.query('SELECT count(*)::int AS n FROM flags')).toEqual([{ n: 3 }]);
    await db.close();
  });

  it('Q-tx: a failing tx rolls back, a successful one commits', async () => {
    const db = await freshDb();
    const users = async () =>
      (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM users'))[0]!.n;

    await expect(
      db.tx(async (t) => {
        await insertUser(t, 'a@x.test', 'admin');
        expect(await t.query('SELECT 1 FROM users')).toHaveLength(1); // visible inside
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await users()).toBe(0);

    // a database error part-way also rolls back the earlier insert
    await expect(
      db.tx(async (t) => {
        await insertUser(t, 'a@x.test', 'admin');
        await insertUser(t, 'b@x.test', 'root'); // CHECK violation
      }),
    ).rejects.toMatchObject({ code: '23514' });
    expect(await users()).toBe(0);

    const result = await db.tx(async (t) => {
      await insertUser(t, 'a@x.test', 'admin');
      return 'done';
    });
    expect(result).toBe('done');
    expect(await users()).toBe(1);
    // the db is usable after a rollback
    await insertUser(db, 'c@x.test', 'viewer');
    expect(await users()).toBe(2);
    await db.close();
  });
});

describe('db url', () => {
  afterEach(() => vi.unstubAllEnvs());
  const dir = tempDir();

  it('Q-db-url: pglite:memory works, a pglite:<dir> persists, unknown scheme throws', async () => {
    const mem = await openDb('pglite:memory');
    expect(await mem.query('SELECT 1 AS one')).toEqual([{ one: 1 }]);
    await mem.close();

    const url = `pglite:${dir}/nested/pg`; // directory is created if missing
    const a = await openDb(url);
    await migrate(a);
    await a.close();
    const b = await openDb(url);
    expect(await schemaVersions(b)).toEqual([1, 2, 3]);
    await b.close();

    for (const bad of ['mysql://u@h/db', 'sqlite:./x.db', './app.db', '']) {
      await expect(openDb(bad), bad).rejects.toThrow(/scheme|unsupported|unknown|invalid/i);
    }
  });

  it('Q-db-url: dbUrlFromEnv reads DATABASE_URL, empty or unset means local PGlite', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@h:5432/d?sslmode=require');
    expect(dbUrlFromEnv()).toBe('postgres://u:p@h:5432/d?sslmode=require');
    vi.stubEnv('DATABASE_URL', 'pglite:memory');
    expect(dbUrlFromEnv()).toBe('pglite:memory');
    vi.stubEnv('DATABASE_URL', '');
    expect(dbUrlFromEnv()).toBe('pglite:./data/pg');
    vi.stubEnv('DATABASE_URL', undefined);
    expect(dbUrlFromEnv()).toBe('pglite:./data/pg');
  });
});

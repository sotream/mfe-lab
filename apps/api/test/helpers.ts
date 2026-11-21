import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, onTestFinished } from 'vitest';
import { buildApp } from '../src/app.ts';
import { migrate, openDb, type Db } from '../src/db.ts';
import { seed } from '../src/seed.ts';

export type { Db };

export const freshDb = async (): Promise<Db> => {
  const db = await openDb('pglite:memory');
  await migrate(db);
  return db;
};

// timestamptz columns come back from the driver as Date; select them as the API's ISO string.
export const isoCol = (col = 'created_at') =>
  `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ${col}`;

export const count = async (db: Db, table: string): Promise<number> =>
  (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`))[0]!.n;

export const counts = async (db: Db) => ({
  users: await count(db, 'users'),
  products: await count(db, 'products'),
  orders: await count(db, 'orders'),
});

export const schemaVersions = async (db: Db): Promise<number[]> =>
  (
    await db.query<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version')
  ).map((r) => r.version);

// One temp dir per test file, removed after the file's tests.
export const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'mfe-api-test-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

// HTTP helpers (T3+): a seeded in-memory app plus one token per seed role.
export const roles = ['admin', 'editor', 'viewer'] as const;
export type Role = (typeof roles)[number];
export type Ctx = { app: Awaited<ReturnType<typeof buildApp>>; tokens: Record<Role, string> };

export const setup = async (): Promise<Ctx> => {
  const app = await buildApp({ dbUrl: 'pglite:memory', jwtSecret: 'test-secret' });
  await seed(app.db);
  const tokens = {} as Record<Role, string>;
  for (const role of roles) {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: `${role}@lab.test`, password: 'lab12345' }, // demo-only seed password
    });
    tokens[role] = res.json<{ token: string }>().token;
  }
  return { app, tokens };
};

// Fresh app for a test that mutates data; closed when the test finishes.
export const freshApp = async (): Promise<Ctx> => {
  const ctx = await setup();
  onTestFinished(() => ctx.app.close());
  return ctx;
};

export type Call = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  as?: Role | null; // null = no Authorization header
  query?: Record<string, string>;
  payload?: object | string;
  headers?: Record<string, string>;
};

export const call = (
  ctx: Ctx,
  { method = 'GET', url, as = 'admin', query, payload, headers }: Call,
) =>
  ctx.app.inject({
    method,
    url,
    query,
    payload,
    headers: { ...(as ? { authorization: `Bearer ${ctx.tokens[as]}` } : {}), ...headers },
  });

export const productKeys = ['created_at', 'id', 'name', 'price_cents', 'sku', 'stock'];
export const orderKeys = ['created_at', 'id', 'product_id', 'qty', 'status'];
export const keysOf = (o: object) => Object.keys(o).sort();
export const isIso = (s: string) => new Date(s).toISOString() === s;

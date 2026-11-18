import { describe, expect, it } from 'vitest';
import { migrate } from '../src/db.ts';
import { freshDb, userVersion, type Db } from './helpers.ts';

type Column = { name: string; type: string; notnull: number; pk: number };

// [name, type, notnull] per the Contract schema table; `id` is the INTEGER primary key.
const schema: Record<string, [string, string, number][]> = {
  users: [
    ['email', 'TEXT', 1],
    ['password_hash', 'TEXT', 1],
    ['role', 'TEXT', 1],
  ],
  products: [
    ['sku', 'TEXT', 1],
    ['name', 'TEXT', 1],
    ['price_cents', 'INTEGER', 1],
    ['stock', 'INTEGER', 1],
    ['created_at', 'TEXT', 1],
  ],
  orders: [
    ['product_id', 'INTEGER', 1],
    ['qty', 'INTEGER', 1],
    ['status', 'TEXT', 1],
    ['created_at', 'TEXT', 1],
  ],
};

const now = '2026-11-01T00:00:00.000Z';
const insertUser = (db: Db, email: string, role: string) =>
  db
    .prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)')
    .run(email, 'h', role);
const insertProduct = (db: Db, sku: string, price: number, stock: number) =>
  db
    .prepare(
      'INSERT INTO products (sku, name, price_cents, stock, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(sku, 'n', price, stock, now);
const insertOrder = (db: Db, productId: number | bigint, qty: number, status: string) =>
  db
    .prepare('INSERT INTO orders (product_id, qty, status, created_at) VALUES (?, ?, ?, ?)')
    .run(productId, qty, status, now);

describe('db', () => {
  it('Q-schema: tables, columns, FK and user_version match the Contract', () => {
    const db = freshDb();
    for (const [table, cols] of Object.entries(schema)) {
      const info = db.pragma(`table_info(${table})`) as Column[];
      const id = info.find((c) => c.name === 'id');
      expect(id, `${table}.id`).toMatchObject({ type: 'INTEGER', pk: 1 });
      const rest = info.filter((c) => c.name !== 'id').map((c) => [c.name, c.type, c.notnull]);
      expect(rest.sort(), table).toEqual([...cols].sort());
    }
    const fks = db.pragma('foreign_key_list(orders)') as {
      table: string;
      from: string;
      to: string;
    }[];
    expect(fks).toContainEqual(
      expect.objectContaining({ table: 'products', from: 'product_id', to: 'id' }),
    );
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(userVersion(db)).toBeGreaterThanOrEqual(1);
  });

  it('Q-constraints: CHECK, UNIQUE and FK violations throw', () => {
    const db = freshDb();
    insertUser(db, 'a@x.test', 'admin');
    const productId = insertProduct(db, 'S-1', 100, 1).lastInsertRowid;
    insertOrder(db, productId, 1, 'new');

    const bad: [string, () => unknown][] = [
      ['role root', () => insertUser(db, 'b@x.test', 'root')],
      ['duplicate email', () => insertUser(db, 'a@x.test', 'viewer')],
      ['duplicate sku', () => insertProduct(db, 'S-1', 100, 1)],
      ['price_cents -1', () => insertProduct(db, 'S-2', -1, 1)],
      ['stock -1', () => insertProduct(db, 'S-3', 100, -1)],
      ['qty 0', () => insertOrder(db, productId, 0, 'new')],
      ['status lost', () => insertOrder(db, productId, 1, 'lost')],
      ['missing product_id', () => insertOrder(db, 99_999, 1, 'new')],
    ];
    for (const [name, fn] of bad) expect(fn, name).toThrow();
  });

  it('Q-migrate-idempotent: second migrate returns the same version', () => {
    const db = freshDb();
    const v1 = userVersion(db);
    expect(migrate(db)).toBe(v1);
    expect(migrate(db)).toBe(v1);
  });
});

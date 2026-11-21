import { describe, expect, it } from 'vitest';
import { seed } from '../src/seed.ts';
import { counts, freshDb, isoCol, type Db } from './helpers.ts';

type Product = { id: number; sku: string; price_cents: number; stock: number; created_at: string };
type Order = { product_id: number; qty: number; status: string; created_at: string };

const full = { users: 3, products: 30, orders: 60 };
const cols = {
  products: 'id, sku, name, price_cents, stock',
  orders: 'id, product_id, qty, status',
};
const rows = (db: Db, table: keyof typeof cols) =>
  db.query(`SELECT ${cols[table]}, ${isoCol()} FROM ${table} ORDER BY ${table}.id`);
const seeded = async () => {
  const db = await freshDb();
  await seed(db);
  return db;
};
const isIso = (s: string) => new Date(s).toISOString() === s;
const inRange = (s: string, from: string, to: string) => s >= from && s < to;

describe('seed', () => {
  it('Q-seed-counts: fresh seed returns and inserts 3/30/60', async () => {
    const db = await freshDb();
    expect(await seed(db)).toEqual({ seeded: true, ...full });
    expect(await counts(db)).toEqual(full);
  });

  it('Q-seed-data: users, products and orders match the Contract', async () => {
    const db = await seeded();
    expect(await db.query('SELECT email, role FROM users ORDER BY email')).toEqual([
      { email: 'admin@lab.test', role: 'admin' },
      { email: 'editor@lab.test', role: 'editor' },
      { email: 'viewer@lab.test', role: 'viewer' },
    ]);

    const products = (await rows(db, 'products')) as Product[];
    const skus = Array.from({ length: 30 }, (_, i) => `SKU-${String(i + 1).padStart(4, '0')}`);
    expect(products.map((p) => p.sku).sort()).toEqual(skus);
    for (const p of products) {
      expect(p.price_cents, p.sku).toBeGreaterThanOrEqual(100);
      expect(p.price_cents, p.sku).toBeLessThanOrEqual(100_000);
      expect(p.stock, p.sku).toBeGreaterThanOrEqual(0);
      expect(p.stock, p.sku).toBeLessThanOrEqual(500);
      expect(isIso(p.created_at), p.created_at).toBe(true);
      expect(inRange(p.created_at, '2026-09-02T00:00:00.000Z', '2026-11-01T00:00:00.000Z')).toBe(
        true,
      );
    }

    const ids = new Set(products.map((p) => p.id));
    const orders = (await rows(db, 'orders')) as Order[];
    for (const o of orders) {
      expect(ids.has(o.product_id), String(o.product_id)).toBe(true);
      expect(o.qty).toBeGreaterThanOrEqual(1);
      expect(o.qty).toBeLessThanOrEqual(10);
      expect(isIso(o.created_at), o.created_at).toBe(true);
      expect(inRange(o.created_at, '2026-10-02T00:00:00.000Z', '2026-11-01T00:00:00.000Z')).toBe(
        true,
      );
    }
    expect(new Set(orders.map((o) => o.status))).toEqual(new Set(['new', 'paid', 'shipped']));
  });

  it('Q-seed-idempotent: second seed is a no-op', async () => {
    const db = await seeded();
    const before = [await rows(db, 'products'), await rows(db, 'orders')];
    expect(await seed(db)).toEqual({ seeded: false, ...full });
    expect([await rows(db, 'products'), await rows(db, 'orders')]).toEqual(before);
  });

  it('Q-seed-reset-restores: no-op after partial wipe, reset restores full data', async () => {
    const db = await seeded();
    await db.exec('DELETE FROM orders; DELETE FROM products;');
    expect(await seed(db)).toEqual({ seeded: false, users: 3, products: 0, orders: 0 });
    expect(await counts(db)).toEqual({ users: 3, products: 0, orders: 0 });
    expect(await seed(db, { reset: true })).toEqual({ seeded: true, ...full });
    expect(await counts(db)).toEqual(full);
  });

  it('Q-seed-reset: reset restarts identity, /products/1 stays Drucksensor, counts 3/30/60', async () => {
    const db = await seeded();
    await seed(db, { reset: true });
    const ids = (await db.query<{ id: number }>('SELECT id FROM products ORDER BY id')).map(
      (r) => r.id,
    );
    expect(ids).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    const orderIds = await db.query<{ min: number; max: number }>(
      'SELECT min(id)::int AS min, max(id)::int AS max FROM orders',
    );
    expect(orderIds).toEqual([{ min: 1, max: 60 }]);
    expect(await db.query('SELECT name FROM products WHERE id = 1')).toEqual([
      { name: 'Drucksensor' },
    ]);
    expect(await counts(db)).toEqual(full);
    // the reset data is the same data as a fresh seed
    expect(await rows(db, 'products')).toEqual(await rows(await seeded(), 'products'));
  });

  it('Q-seed-deterministic: two fresh DBs get identical data except password salts', async () => {
    const [a, b] = [await seeded(), await seeded()];
    expect(rows(a, 'products')).toEqual(rows(b, 'products'));
    expect(rows(a, 'orders')).toEqual(rows(b, 'orders'));
    const users = (db: Db) => db.query('SELECT id, email, role FROM users ORDER BY id');
    expect(await users(a)).toEqual(await users(b));
  });
});

describe('seed names', () => {
  it('Q-seed-names: 30 distinct names, none from the old adjective x noun generator', async () => {
    const db = await seeded();
    const names = (await db.query<{ name: string }>('SELECT name FROM products')).map(
      (r) => r.name,
    );
    expect(names).toHaveLength(30);
    expect(new Set(names).size).toBe(30);
    const old =
      /^(Compact|Rugged|Smart|Classic|Mini) (Widget|Gadget|Gizmo|Bracket|Cable|Lamp|Valve|Sensor)$/;
    expect(names.filter((n) => old.test(n))).toEqual([]);
    expect(await db.query("SELECT name FROM products WHERE sku = 'SKU-0001'")).toEqual([
      { name: 'Drucksensor' }, // German market (T27)
    ]);
    expect(names).not.toContain('Pressure Sensor');
  });
});

import { dbPathFromEnv, migrate, openDb, type Database } from './db.ts';
import { hashPassword } from './password.ts';

// Demo-only credentials. Never use outside the lab.
const DEMO_PASSWORD = 'lab12345';
const USERS = [
  { email: 'admin@lab.test', role: 'admin' },
  { email: 'editor@lab.test', role: 'editor' },
  { email: 'viewer@lab.test', role: 'viewer' },
] as const;
const STATUSES = ['new', 'paid', 'shipped'] as const;
const NAMES = [
  'Drucksensor',
  'Durchflussventil',
  'Relaisplatine',
  'Temperaturfühler',
  'Schrittmotortreiber',
  'Logikanalysator',
  'Signalgenerator',
  'Netzteil',
  'Servoregler',
  'Wägezelle',
  'Gasmelder',
  'Feuchtesensor',
  'Strommesswiderstand',
  'Magnetventil',
  'Tischmultimeter',
  'Oszilloskop-Tastkopf',
  'Adapterplatine',
  'Thermoelementverstärker',
  'Pumpensteuerung',
  'Füllstandschalter',
  'Vibrationssensor',
  'Encodermodul',
  'Datenlogger',
  'Trennverstärker',
  'Lüftersteuerung',
  'Lichtsensor',
  'Spannungsteiler-Set',
  'Motortreiber',
  'Drehmomentsensor',
  'Impulszähler',
];

const DAY = 86_400_000;
const PRODUCTS_FROM = Date.parse('2026-09-02T00:00:00.000Z');
const ORDERS_FROM = Date.parse('2026-10-02T00:00:00.000Z');
const PRODUCTS = 30;
const ORDERS = 60;

// mulberry32: tiny seeded RNG, keeps the seed deterministic.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type SeedResult = { seeded: boolean; users: number; products: number; orders: number };

const count = (db: Database, table: 'users' | 'products' | 'orders'): number =>
  Number((db.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n);

export async function seed(db: Database, opts: { reset?: boolean } = {}): Promise<SeedResult> {
  if (!opts.reset && count(db, 'users') > 0) {
    return {
      seeded: false,
      users: count(db, 'users'),
      products: count(db, 'products'),
      orders: count(db, 'orders'),
    };
  }

  // Hash before the sync transaction: scrypt is async.
  const hashes = await Promise.all(USERS.map(() => hashPassword(DEMO_PASSWORD)));
  const rnd = mulberry32(20261101);
  const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
  const iso = (from: number, days: number) =>
    new Date(from + Math.floor(rnd() * days * DAY)).toISOString();

  db.transaction(() => {
    db.exec('delete from orders; delete from products; delete from users;');

    const addUser = db.prepare('insert into users (email, password_hash, role) values (?, ?, ?)');
    USERS.forEach((u, i) => addUser.run(u.email, hashes[i], u.role));

    const addProduct = db.prepare(
      'insert into products (sku, name, price_cents, stock, created_at) values (?, ?, ?, ?, ?)',
    );
    const productIds: number[] = [];
    for (let i = 0; i < PRODUCTS; i++) {
      const name = NAMES[i]!;
      const sku = `SKU-${String(i + 1).padStart(4, '0')}`;
      const info = addProduct.run(
        sku,
        name,
        int(100, 100_000),
        int(0, 500),
        iso(PRODUCTS_FROM, 60),
      );
      productIds.push(Number(info.lastInsertRowid));
    }

    const addOrder = db.prepare(
      'insert into orders (product_id, qty, status, created_at) values (?, ?, ?, ?)',
    );
    for (let i = 0; i < ORDERS; i++) {
      // The first three orders guarantee every status appears.
      const status = i < STATUSES.length ? STATUSES[i] : STATUSES[int(0, STATUSES.length - 1)];
      addOrder.run(productIds[int(0, PRODUCTS - 1)], int(1, 10), status, iso(ORDERS_FROM, 30));
    }
  })();

  return { seeded: true, users: USERS.length, products: PRODUCTS, orders: ORDERS };
}

if (import.meta.main) {
  const db = openDb(dbPathFromEnv());
  migrate(db);
  const reset = process.argv.includes('--reset');
  const r = await seed(db, { reset });
  db.close();
  console.log(
    r.seeded
      ? `seeded ${r.users} users, ${r.products} products, ${r.orders} orders`
      : `already seeded (${r.users} users, ${r.products} products, ${r.orders} orders); use seed:reset to wipe`,
  );
}

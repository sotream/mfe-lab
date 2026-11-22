import { dbUrlFromEnv, migrate, openDb, type Db } from './db.ts';
import { hashPassword } from './password.ts';

// Demo-only credentials. Never use outside the lab.
const DEMO_PASSWORD = 'lab12345';
const USERS = [
  { email: 'admin@lab.test', role: 'admin' },
  { email: 'editor@lab.test', role: 'editor' },
  { email: 'viewer@lab.test', role: 'viewer' },
] as const;
// Flag defaults, as in migration 002; a reseed puts every flag back to these.
const FLAG_DEFAULTS = {
  'dashboard.revenue': true,
  'products.detailPage': true,
  'products.crash': false,
} as const;
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

const count = async (db: Db, table: 'users' | 'products' | 'orders'): Promise<number> =>
  (await db.query<{ n: number }>(`select count(*)::int as n from ${table}`))[0]!.n;

export async function seed(db: Db, opts: { reset?: boolean } = {}): Promise<SeedResult> {
  if (!opts.reset && (await count(db, 'users')) > 0) {
    return {
      seeded: false,
      users: await count(db, 'users'),
      products: await count(db, 'products'),
      orders: await count(db, 'orders'),
    };
  }

  // Hash first, so the transaction stays short.
  const hashes = await Promise.all(USERS.map(() => hashPassword(DEMO_PASSWORD)));
  const rnd = mulberry32(20261101);
  const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
  const iso = (from: number, days: number) =>
    new Date(from + Math.floor(rnd() * days * DAY)).toISOString();

  await db.tx(async (t) => {
    await t.exec('truncate orders, products, users restart identity cascade');
    // Visitors toggle flags and report errors; the daily reset clears both.
    await t.exec('truncate errors');
    for (const [name, enabled] of Object.entries(FLAG_DEFAULTS)) {
      await t.query('update flags set enabled = $1 where name = $2', [enabled, name]);
    }

    for (const [i, u] of USERS.entries()) {
      await t.query('insert into users (email, password_hash, role) values ($1, $2, $3)', [
        u.email,
        hashes[i],
        u.role,
      ]);
    }

    // The owner account lives in env only: all three set means it is (re)created, otherwise it does not exist.
    const {
      SUPERADMIN_EMAIL: email,
      SUPERADMIN_PASSWORD_HASH: hash,
      SUPERADMIN_TOTP_SECRET: totp,
    } = process.env;
    if (email && hash && totp) {
      await t.query('insert into users (email, password_hash, role) values (lower($1), $2, $3)', [
        email,
        hash,
        'superadmin',
      ]);
    }

    // Registry back to stable: no canary, 0%, enabled (RFC 0017).
    await t.exec('truncate remotes');
    await t.exec("insert into remotes (name) values ('dashboard'), ('orders'), ('products')");

    const productIds: number[] = [];
    for (let i = 0; i < PRODUCTS; i++) {
      const name = NAMES[i]!;
      const sku = `SKU-${String(i + 1).padStart(4, '0')}`;
      const [row] = await t.query<{ id: number }>(
        'insert into products (sku, name, price_cents, stock, created_at) values ($1, $2, $3, $4, $5) returning id',
        [sku, name, int(100, 100_000), int(0, 500), iso(PRODUCTS_FROM, 60)],
      );
      productIds.push(row!.id);
    }

    for (let i = 0; i < ORDERS; i++) {
      // The first three orders guarantee every status appears.
      const status = i < STATUSES.length ? STATUSES[i] : STATUSES[int(0, STATUSES.length - 1)];
      await t.query(
        'insert into orders (product_id, qty, status, created_at) values ($1, $2, $3, $4)',
        [productIds[int(0, PRODUCTS - 1)], int(1, 10), status, iso(ORDERS_FROM, 30)],
      );
    }
  });

  return { seeded: true, users: USERS.length, products: PRODUCTS, orders: ORDERS };
}

if (import.meta.main) {
  const db = await openDb(dbUrlFromEnv());
  await migrate(db);
  const reset = process.argv.includes('--reset');
  const r = await seed(db, { reset });
  await db.close();
  console.log(
    r.seeded
      ? `seeded ${r.users} users, ${r.products} products, ${r.orders} orders`
      : `already seeded (${r.users} users, ${r.products} products, ${r.orders} orders); use seed:reset to wipe`,
  );
}

import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { migrate, openDb, type Db } from '../src/db.ts';
import { seed } from '../src/seed.ts';
import { PROD_SECRET, stubProd, type App } from './owner.ts';

// T51 black-box tests for the Postgres-backed rate-limit store.
// Two apps share one database through buildApp's `db` option (the caller closes the db).
const state = { db: undefined as Db | undefined, failStore: false };

const IP = '203.0.113.77'; // documentation range
const ipHeaders = { 'x-forwarded-for': IP };

const instance = async (): Promise<App> => {
  const app = await buildApp({ dbUrl: '', db: state.db!, jwtSecret: PROD_SECRET });
  onTestFinished(() => app.close());
  return app as App;
};
const login = (app: App, password: string, headers: Record<string, string> = ipHeaders) =>
  app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'viewer@lab.test', password },
    headers,
  });

// Fresh shared database per test, with seed data. Store queries fail while state.failStore is set.
const fresh = async () => {
  vi.stubEnv('VERCEL', '1'); // trustProxy on, so x-forwarded-for sets request.ip
  const real = await openDb('pglite:memory');
  await migrate(real);
  state.failStore = false;
  state.db = {
    ...real,
    query: async (sql, params) => {
      if (state.failStore && /rate_limits/i.test(sql)) throw new Error('stubbed db failure');
      return real.query(sql, params);
    },
  };
  onTestFinished(() => real.close());
  await seed(state.db);
  return instance();
};

afterEach(() => vi.unstubAllEnvs());

describe('shared rate-limit store', () => {
  it('Q-shared-limit: two app instances on one database share the login counter', async () => {
    const a = await fresh();
    const b = await instance();
    for (let i = 0; i < 6; i++) expect((await login(a, 'wrong-password')).statusCode).toBe(401);
    for (let i = 0; i < 4; i++) expect((await login(b, 'wrong-password')).statusCode).toBe(401);
    expect((await login(b, 'wrong-password')).statusCode).toBe(429); // 11th overall
    expect((await login(a, 'lab12345')).statusCode).toBe(429); // A sees it too
    // another IP has its own budget
    expect((await login(a, 'lab12345', { 'x-forwarded-for': '203.0.113.78' })).statusCode).toBe(
      200,
    );
  });

  it('Q-window-reset: once the window has passed the counter starts again', async () => {
    const a = await fresh();
    for (let i = 0; i < 10; i++) expect((await login(a, 'wrong-password')).statusCode).toBe(401);
    expect((await login(a, 'lab12345')).statusCode).toBe(429);
    // No clock hook: expire the window in the table (rate_limits.reset_at, per the contract).
    await a.db.exec("update rate_limits set reset_at = now() - interval '1 second'");
    expect((await login(a, 'lab12345')).statusCode).toBe(200);
    for (let i = 0; i < 9; i++) expect((await login(a, 'wrong-password')).statusCode).toBe(401);
    expect((await login(a, 'wrong-password')).statusCode).toBe(429); // fresh window: 11th = 429
  });

  it('Q-fail-open: a failing store lets login through and logs a warning', async () => {
    const app = await fresh();
    const warn = vi.spyOn(app.log, 'warn');
    state.failStore = true;
    for (let i = 0; i < 12; i++) expect((await login(app, 'lab12345')).statusCode).toBe(200);
    expect(warn).toHaveBeenCalled();
  });

  it('Q-no-raw-ip: no stored key contains the client IP in plain text', async () => {
    const a = await fresh();
    expect((await login(a, 'lab12345')).statusCode).toBe(200);
    const rows = await a.db.query<{ key: string }>('select key from rate_limits');
    expect(rows.length).toBeGreaterThan(0);
    for (const { key } of rows) {
      expect(key).not.toContain(IP);
      expect(key).not.toContain(IP.replaceAll('.', ''));
    }
  });
});

describe('RATE_LIMIT=off switch', () => {
  it('Q-off-switch: off disables limits outside production', async () => {
    vi.stubEnv('RATE_LIMIT', 'off');
    const a = await fresh();
    for (let i = 0; i < 12; i++) expect((await login(a, 'wrong-password')).statusCode).toBe(401);
  });

  it('Q-off-switch: off is ignored with VERCEL_ENV=production', async () => {
    vi.stubEnv('RATE_LIMIT', 'off');
    stubProd();
    const a = await fresh();
    for (let i = 0; i < 10; i++) expect((await login(a, 'wrong-password')).statusCode).toBe(401);
    expect((await login(a, 'wrong-password')).statusCode).toBe(429);
  });
});

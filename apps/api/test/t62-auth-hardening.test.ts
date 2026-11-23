// T62: login failure counter, reseed state, upsert demotion, canary production flag, demo rate-limit key.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAllowedCanary } from '../../../deploy/canary.ts';
import { seed, upsertEnvAccount } from '../src/seed.ts';
import {
  authed,
  loginReq,
  ownerToken,
  refTotp,
  seededApp,
  stubOwnerEnv,
  stubPreview,
  stubProd,
  tokenOf,
  type App,
} from './owner.ts';

afterEach(() => vi.unstubAllEnvs());

const MAX_FAILURES = 5;
type State = { failed_attempts: number; locked_until: Date | null; totp_last_step: string | null };
const stateOf = async (app: App, email: string): Promise<State> =>
  (
    await app.db.query<State>(
      'select failed_attempts, locked_until, totp_last_step from users where email = $1',
      [email],
    )
  )[0]!;
const lockedNow = (s: State) => s.locked_until !== null && new Date(s.locked_until) > new Date();

describe('T62 login failure counter', () => {
  it('Q-t62-auth: 10 parallel wrong passwords count at most 5 failures, then lock', async () => {
    const o = await stubOwnerEnv();
    const app = await seededApp();
    const res = await Promise.all(
      Array.from({ length: 10 }, () => loginReq(app, o.email, `wrong-${Math.random()}`)),
    );
    for (const r of res) expect(r.statusCode).toBe(401);
    const s = await stateOf(app, o.email);
    expect(Number(s.failed_attempts)).toBeLessThanOrEqual(MAX_FAILURES);
    expect(lockedNow(s)).toBe(true);
  });

  it('Q-t62-auth: 10 parallel wrong codes (right password) count at most 5 failures, then lock', async () => {
    const o = await stubOwnerEnv();
    const app = await seededApp();
    const bad = refTotp(o.key, Date.now() + 600_000); // far outside the window
    const res = await Promise.all(
      Array.from({ length: 10 }, () => loginReq(app, o.email, o.password, bad)),
    );
    for (const r of res) expect(r.statusCode).toBe(401);
    const s = await stateOf(app, o.email);
    expect(Number(s.failed_attempts)).toBeLessThanOrEqual(MAX_FAILURES);
    expect(lockedNow(s)).toBe(true);
  });

  it('Q-t62-auth: while locked, a correct password and code is refused with the generic error', async () => {
    const o = await stubOwnerEnv();
    const app = await seededApp();
    await Promise.all(Array.from({ length: 6 }, () => loginReq(app, o.email, 'wrong-password')));
    const res = await loginReq(app, o.email, o.password, refTotp(o.key, Date.now()));
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'invalid_credentials' });
  });

  it('Q-t62-auth: a lock that has run out lets the correct password and code in again', async () => {
    const o = await stubOwnerEnv();
    const app = await seededApp();
    await Promise.all(Array.from({ length: 6 }, () => loginReq(app, o.email, 'wrong-password')));
    await app.db.query(
      "update users set locked_until = now() - interval '1 minute' where email = $1",
      [o.email],
    );
    const res = await loginReq(app, o.email, o.password, refTotp(o.key, Date.now()));
    expect(res.statusCode, res.body).toBe(200);
  });
});

describe('T62 reseed keeps the env account security state', () => {
  it('Q-t62-seed: failed_attempts, locked_until and totp_last_step survive a reseed', async () => {
    const o = await stubOwnerEnv();
    const app = await seededApp();
    await app.db.query(
      `update users set failed_attempts = 3, locked_until = now() + interval '10 minutes',
         totp_last_step = 12345 where email = $1`,
      [o.email],
    );
    const before = await stateOf(app, o.email);
    await seed(app.db, { reset: true });
    const after = await stateOf(app, o.email);
    expect(Number(after.failed_attempts)).toBe(3);
    expect(String(after.totp_last_step)).toBe('12345');
    expect(new Date(after.locked_until!).getTime()).toBe(new Date(before.locked_until!).getTime());
  });

  it('Q-t62-seed: a code used before a reseed is still rejected after it', async () => {
    const o = await stubOwnerEnv();
    const app = await seededApp();
    const code = refTotp(o.key, Date.now());
    expect((await loginReq(app, o.email, o.password, code)).statusCode).toBe(200);
    await seed(app.db, { reset: true });
    const again = await loginReq(app, o.email, o.password, code);
    expect(again.statusCode).toBe(401);
    expect(again.json()).toEqual({ error: 'invalid_credentials' });
  });
});

describe('T62 upsertEnvAccount demotes stale rows', () => {
  it('Q-t62-upsert: another superadmin row becomes a viewer; the env account stays; idempotent', async () => {
    const o = await stubOwnerEnv();
    const app = await seededApp();
    await app.db.query(
      "insert into users (email, password_hash, role) values ('old-owner@test.invalid', 'x', 'superadmin')",
    );
    for (let i = 0; i < 2; i++) {
      await upsertEnvAccount(app.db);
      const supers = await app.db.query<{ email: string }>(
        "select email from users where role = 'superadmin'",
      );
      expect(supers).toEqual([{ email: o.email }]);
    }
    const old = await app.db.query<{ role: string }>(
      "select role from users where email = 'old-owner@test.invalid'",
    );
    expect(old).toEqual([{ role: 'viewer' }]);
  });
});

describe('T62 canary allowlist, production flag', () => {
  // T62: shape may need adapting in phase 2 (third argument: production)
  const canary = isAllowedCanary as (
    v: string,
    allowLocal: boolean,
    production?: boolean,
  ) => boolean;
  const PROD = 'https://mfe-lab-products.vercel.app/mf-manifest.json';
  const PREVIEW = 'https://mfe-lab-products-pr-12.vercel.app/mf-manifest.json';

  it('Q-t62-canary: with the production flag a preview host is refused, production origins pass', () => {
    expect(canary(PREVIEW, false, true)).toBe(false);
    expect(canary(PROD, false, true)).toBe(true);
    expect(canary('https://evil.example/mf-manifest.json', false, true)).toBe(false);
  });

  it('Q-t62-canary: without the flag preview hosts are accepted; existing cases hold', () => {
    expect(canary(PREVIEW, false)).toBe(true);
    expect(canary(PREVIEW, false, false)).toBe(true);
    expect(canary(PROD, false)).toBe(true);
    expect(canary('http://localhost:3001/mf-manifest.json', true)).toBe(true);
    expect(canary('http://localhost:3001/mf-manifest.json', false)).toBe(false);
  });

  it('Q-t62-canary: PATCH /registry on the live API refuses a preview host (as the env account)', async () => {
    stubProd();
    const o = await stubOwnerEnv();
    const app = await seededApp();
    const token = await ownerToken(app, o);
    const bad = await authed(app, token, 'PATCH', '/registry/products', { canaryUrl: PREVIEW });
    expect(bad.statusCode).toBe(400);
    expect(bad.json<{ error: string }>().error).toBe('invalid_canary_url');
    const ok = await authed(app, token, 'PATCH', '/registry/products', { canaryUrl: PROD });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('Q-t62-canary: PATCH /registry on a preview API still accepts a preview host', async () => {
    stubPreview();
    const app = await seededApp();
    const token = await tokenOf(app, 'admin@lab.test');
    const res = await authed(app, token, 'PATCH', '/registry/products', { canaryUrl: PREVIEW });
    expect(res.statusCode, res.body).toBe(200);
  });
});

describe('T62 write rate limit for demo users is per user and IP', () => {
  const write = (app: App, token: string, ip: string, n: number) =>
    app.inject({
      method: 'POST',
      url: '/products',
      remoteAddress: ip,
      headers: { authorization: `Bearer ${token}` },
      payload: { sku: `T62-${ip}-${n}`, name: 'R', price_cents: 1, stock: 1 },
    });
  const exhaust = async (app: App, token: string, ip: string) => {
    for (let i = 0; i < 60; i++) expect((await write(app, token, ip, i)).statusCode).toBe(201);
    expect((await write(app, token, ip, 60)).statusCode).toBe(429);
  };

  it('Q-t62-ratelimit: a demo admin has an independent write bucket per IP', async () => {
    stubProd();
    const app = await seededApp();
    const a = await tokenOf(app, 'admin@lab.test');
    const b = await tokenOf(app, 'admin@lab.test');
    await exhaust(app, a, '10.1.0.1');
    expect((await write(app, b, '10.1.0.2', 0)).statusCode).toBe(201);
  });

  it('Q-t62-ratelimit: the same IP shares the demo admin bucket', async () => {
    stubProd();
    const app = await seededApp();
    const a = await tokenOf(app, 'admin@lab.test');
    const b = await tokenOf(app, 'admin@lab.test');
    await exhaust(app, a, '10.1.0.1');
    expect((await write(app, b, '10.1.0.1', 100)).statusCode).toBe(429);
  });

  it('Q-t62-ratelimit: a user who is not demo-locked is keyed by id only', async () => {
    const app = await seededApp(); // no production env: nobody is demo-locked
    const a = await tokenOf(app, 'admin@lab.test');
    await exhaust(app, a, '10.1.0.1');
    expect((await write(app, a, '10.1.0.2', 100)).statusCode).toBe(429);
  });
});

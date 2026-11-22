import { afterEach, describe, expect, it, vi } from 'vitest';
import { seed } from '../src/seed.ts';
import {
  authed,
  loginReq,
  ownerToken,
  refTotp,
  seededApp,
  stubOwnerEnv,
  stubProd,
  tokenOf,
} from './owner.ts';

afterEach(() => vi.unstubAllEnvs());

const ownerRows = (db: Awaited<ReturnType<typeof seededApp>>['db']) =>
  db.query<{ email: string }>("select email from users where role = 'superadmin'");

describe('owner account with 2FA', () => {
  it('Q-superadmin: no env, no owner account after seed; with env it exists', async () => {
    const none = await seededApp();
    expect(await ownerRows(none.db)).toEqual([]);
    for (const missing of [
      'SUPERADMIN_EMAIL',
      'SUPERADMIN_PASSWORD_HASH',
      'SUPERADMIN_TOTP_SECRET',
    ]) {
      await stubOwnerEnv();
      vi.stubEnv(missing, '');
      const partial = await seededApp();
      expect(await ownerRows(partial.db), `without ${missing}`).toEqual([]);
      vi.unstubAllEnvs();
    }
    const o = await stubOwnerEnv();
    const app = await seededApp();
    expect(await ownerRows(app.db)).toEqual([{ email: o.email }]);
  });

  it('Q-superadmin: right password and no otp gives 401 otp_required', async () => {
    const o = await stubOwnerEnv();
    const app = await seededApp();
    const res = await loginReq(app, o.email, o.password);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'otp_required' });
  });

  it('Q-superadmin: a valid code logs in; the token lives at most 15 minutes', async () => {
    const o = await stubOwnerEnv();
    const app = await seededApp();
    const res = await loginReq(app, o.email, o.password, refTotp(o.key, Date.now()));
    expect(res.statusCode, res.body).toBe(200);
    const { token, user } = res.json<{ token: string; user: { email: string } }>();
    expect(user.email).toBe(o.email);
    const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as {
      exp: number;
      iat: number;
    };
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(15 * 60);
  });

  it('Q-superadmin: the code from the previous step is accepted (+-1 step window)', async () => {
    const o = await stubOwnerEnv();
    const app = await seededApp();
    const res = await loginReq(app, o.email, o.password, refTotp(o.key, Date.now() - 30_000));
    expect(res.statusCode, res.body).toBe(200);
  });

  it('Q-superadmin: reusing a code that already worked gives 401', async () => {
    const o = await stubOwnerEnv();
    const app = await seededApp();
    const code = refTotp(o.key, Date.now());
    expect((await loginReq(app, o.email, o.password, code)).statusCode).toBe(200);
    const again = await loginReq(app, o.email, o.password, code);
    expect(again.statusCode).toBe(401);
    expect(again.json()).toEqual({ error: 'invalid_credentials' });
  });

  it('Q-superadmin: wrong or out-of-window codes give a generic 401', async () => {
    const o = await stubOwnerEnv();
    const app = await seededApp();
    const good = refTotp(o.key, Date.now());
    const wrong = String((Number(good) + 1) % 1_000_000).padStart(6, '0');
    for (const otp of [
      wrong,
      refTotp(o.key, Date.now() + 10 * 30_000),
      refTotp(o.key, Date.now() - 10 * 30_000),
      'abcdef',
    ]) {
      const res = await loginReq(app, o.email, o.password, otp);
      expect(res.statusCode, otp).toBe(401);
      expect(res.json(), otp).toEqual({ error: 'invalid_credentials' });
    }
  });

  it('Q-superadmin: a wrong password gives the same generic 401, with or without otp', async () => {
    const o = await stubOwnerEnv();
    const app = await seededApp();
    for (const otp of [undefined, refTotp(o.key, Date.now())]) {
      const res = await loginReq(app, o.email, 'not-the-password', otp);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'invalid_credentials' });
    }
  });

  it('Q-superadmin: 5 failed attempts lock the account, even for correct credentials and a fresh code', async () => {
    const o = await stubOwnerEnv();
    const app = await seededApp();
    for (let i = 0; i < 5; i++) {
      expect((await loginReq(app, o.email, o.password, '00000' + i)).statusCode).toBe(401);
    }
    const res = await loginReq(app, o.email, o.password, refTotp(o.key, Date.now()));
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'invalid_credentials' });
  });

  it('Q-superadmin: superadmin passes every destructive route in production mode', async () => {
    const o = await stubOwnerEnv();
    stubProd();
    const app = await seededApp();
    const token = await ownerToken(app, o);
    const made = await authed(app, token, 'POST', '/products', {
      sku: 'OWN-0001',
      name: 'Own',
      price_cents: 1,
      stock: 1,
    });
    expect(made.statusCode, made.body).toBe(201);
    const calls = [
      authed(app, token, 'PATCH', '/registry/products', { canaryPercent: 10 }),
      authed(app, token, 'PATCH', '/flags/products.crash', { enabled: true }),
      authed(app, token, 'POST', '/orders', { product_id: 1, qty: 1 }),
      authed(app, token, 'PATCH', '/orders/1', { status: 'paid' }),
    ];
    for (const res of await Promise.all(calls)) expect(res.statusCode, res.body).toBeLessThan(300);
    expect((await authed(app, token, 'DELETE', '/errors')).statusCode).toBe(204);
    expect(
      (await authed(app, token, 'DELETE', `/products/${made.json<{ id: number }>().id}`))
        .statusCode,
    ).toBe(204);
  });

  it('Q-superadmin: /auth/me returns the owner without the demo flag', async () => {
    const o = await stubOwnerEnv();
    stubProd();
    const app = await seededApp();
    const token = await ownerToken(app, o);
    const me = (
      await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: `Bearer ${token}` },
      })
    ).json<{ demo?: boolean; user: { email: string; role: string; demo?: boolean } }>();
    expect(me.user.email).toBe(o.email);
    expect(me.demo ?? me.user.demo).toBeFalsy();
    // the shell maps this role to "admin" (see apps/shell/test/demo-banner.test.tsx)
    expect(me.user.role).toBe('superadmin');
  });

  it('Q-superadmin: the daily reseed keeps the owner, and recreates it if the row is gone', async () => {
    const o = await stubOwnerEnv();
    const app = await seededApp();
    await seed(app.db, { reset: true });
    expect(await ownerRows(app.db)).toEqual([{ email: o.email }]);
    expect((await loginReq(app, o.email, o.password, refTotp(o.key, Date.now()))).statusCode).toBe(
      200,
    );
    await app.db.query("delete from users where role = 'superadmin'");
    await seed(app.db, { reset: true });
    expect(await ownerRows(app.db)).toEqual([{ email: o.email }]);
  });

  it('Q-superadmin: the reseed without env leaves no owner', async () => {
    await stubOwnerEnv();
    const app = await seededApp();
    vi.unstubAllEnvs();
    await seed(app.db, { reset: true });
    expect(await ownerRows(app.db)).toEqual([]);
    expect((await tokenOf(app, 'admin@lab.test')).length).toBeGreaterThan(10);
  });
});

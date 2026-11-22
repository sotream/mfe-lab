import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { hashPassword } from '../src/password.ts';
import { loginReq, PROD_SECRET, refTotp, stubOwnerEnv } from './owner.ts';

afterEach(() => vi.unstubAllEnvs());

// No seed() call: the owner row may only come from the login path.
const bareApp = async () => {
  const app = await buildApp({ dbUrl: 'pglite:memory', jwtSecret: PROD_SECRET, migrate: true });
  return app;
};
const emails = async (app: Awaited<ReturnType<typeof bareApp>>) =>
  (await app.db.query<{ email: string }>('select email from users')).map((r) => r.email);

describe('owner account provisioned from env on login', () => {
  it('Q-owner-lazy: correct password without seed gives otp_required and creates the row', async () => {
    const o = await stubOwnerEnv();
    const app = await bareApp();
    expect(await emails(app)).toEqual([]);
    const res = await loginReq(app, o.email, o.password);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'otp_required' });
    expect(await emails(app)).toEqual([o.email]);
    await app.close();
  });

  it('Q-owner-lazy: email match is case-insensitive', async () => {
    const o = await stubOwnerEnv();
    const app = await bareApp();
    const res = await loginReq(app, o.email.toUpperCase(), o.password);
    expect(res.json()).toEqual({ error: 'otp_required' });
    expect(await emails(app)).toEqual([o.email]); // stored lower-cased
    await app.close();
  });

  it('Q-owner-lazy: a valid TOTP logs in, and repeated attempts do not duplicate the row', async () => {
    const o = await stubOwnerEnv();
    const app = await bareApp();
    await loginReq(app, o.email, o.password);
    const res = await loginReq(app, o.email, o.password, refTotp(o.key, Date.now()));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ user: { email: string } }>().user.email).toBe(o.email);
    expect(await emails(app)).toEqual([o.email]);
    await app.close();
  });

  it('Q-owner-lazy: a changed hash in env takes effect on the next attempt', async () => {
    const o = await stubOwnerEnv();
    const app = await bareApp();
    expect((await loginReq(app, o.email, o.password)).json()).toEqual({ error: 'otp_required' });
    const next = randomBytes(12).toString('base64url');
    vi.stubEnv('SUPERADMIN_PASSWORD_HASH', await hashPassword(next));
    expect((await loginReq(app, o.email, next)).json()).toEqual({ error: 'otp_required' });
    const old = await loginReq(app, o.email, o.password);
    expect(old.statusCode).toBe(401);
    expect(old.json()).not.toEqual({ error: 'otp_required' });
    expect(await emails(app)).toEqual([o.email]);
    await app.close();
  });

  it('Q-owner-lazy: another email never creates a row', async () => {
    const o = await stubOwnerEnv();
    const app = await bareApp();
    for (const email of ['other@test.invalid', 'x' + o.email]) {
      const res = await loginReq(app, email, o.password);
      expect(res.statusCode, email).toBe(401);
    }
    expect(await emails(app)).toEqual([]);
    await app.close();
  });

  it('Q-owner-lazy: with any owner env var missing, the owner email creates no row', async () => {
    for (const missing of ['SUPERADMIN_PASSWORD_HASH', 'SUPERADMIN_TOTP_SECRET']) {
      const o = await stubOwnerEnv();
      vi.stubEnv(missing, '');
      const app = await bareApp();
      const res = await loginReq(app, o.email, o.password);
      expect(res.statusCode, missing).toBe(401);
      expect(await emails(app), missing).toEqual([]);
      await app.close();
      vi.unstubAllEnvs();
    }
  });
});

describe('cron reseed auth diagnostics', () => {
  const SECRET = randomBytes(18).toString('base64url');
  const setup = async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    const app = await buildApp({ dbUrl: 'pglite:memory', jwtSecret: PROD_SECRET, migrate: true });
    const warn = vi.spyOn(app.log, 'warn');
    return { app, warn };
  };
  const get = (app: Awaited<ReturnType<typeof setup>>['app'], headers: Record<string, string>) =>
    app.inject({ method: 'GET', url: '/cron/reseed', headers });
  // ASSUMPTION: the diagnostics go through app.log.warn with a fields object; stringify every argument.
  const logged = (warn: ReturnType<typeof vi.spyOn>) => JSON.stringify(warn.mock.calls);

  it('Q-cron-diag: a wrong header gives 401 and a warn log with booleans and lengths', async () => {
    const { app, warn } = await setup();
    const given = `Bearer ${randomBytes(9).toString('base64url')}`;
    const res = await get(app, { authorization: given, 'user-agent': 'vercel-cron/1.0' });
    expect(res.statusCode).toBe(401);
    const out = logged(warn);
    expect(out).toContain('"hasHeader":true');
    expect(out).toContain('"startsWithBearer":true');
    expect(out).toContain(`"givenLength":${given.length}`);
    expect(out).toContain(`"expectedLength":${`Bearer ${SECRET}`.length}`);
    expect(out).toContain('vercel-cron/1.0');
    expect(out).toContain('cron reseed unauthorized');
    await app.close();
  });

  it('Q-cron-diag: no header and a non-bearer header are reported as such', async () => {
    const { app, warn } = await setup();
    expect((await get(app, {})).statusCode).toBe(401);
    expect(logged(warn)).toContain('"hasHeader":false');
    warn.mockClear();
    expect((await get(app, { authorization: `Basic ${SECRET}` })).statusCode).toBe(401);
    expect(logged(warn)).toContain('"startsWithBearer":false');
    await app.close();
  });

  it('Q-cron-diag: the user agent is truncated to 60 chars', async () => {
    const { app, warn } = await setup();
    await get(app, { authorization: 'Bearer nope', 'user-agent': 'ua-' + 'a'.repeat(100) });
    const out = logged(warn);
    expect(out).toContain('ua-' + 'a'.repeat(57));
    expect(out).not.toContain('a'.repeat(58));
    await app.close();
  });

  it('Q-cron-diag: the log holds neither the given nor the expected secret', async () => {
    const { app, warn } = await setup();
    const givenSecret = randomBytes(18).toString('base64url');
    const res = await get(app, { authorization: `Bearer ${givenSecret}` });
    expect(res.statusCode).toBe(401);
    expect(warn).toHaveBeenCalled();
    const out = logged(warn);
    expect(out).not.toContain(givenSecret);
    expect(out).not.toContain(SECRET);
    // not even a fragment of either
    expect(out).not.toContain(givenSecret.slice(0, 8));
    expect(out).not.toContain(SECRET.slice(0, 8));
    await app.close();
  });

  it('Q-cron-diag: a correct header gives 200 and no auth warning', async () => {
    const { app, warn } = await setup();
    const res = await get(app, { authorization: `Bearer ${SECRET}` });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ reseeded: true });
    expect(logged(warn)).not.toContain('givenLength');
    await app.close();
  });
});

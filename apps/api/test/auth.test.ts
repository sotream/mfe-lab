import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { seed } from '../src/seed.ts';

const secret = 'test-secret';
const demo = 'lab12345'; // demo-only seed password, see README
const users = [
  { email: 'admin@lab.test', role: 'admin' },
  { email: 'editor@lab.test', role: 'editor' },
  { email: 'viewer@lab.test', role: 'viewer' },
] as const;

type App = Awaited<ReturnType<typeof buildApp>>;
type LoginBody = { token: string; user: { id: number; email: string; role: string } };

const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const decode = (segment: string) =>
  JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
// Hand-made HS256 JWT, so expiry and foreign secrets can be tested without waiting.
const sign = (payload: object, key = secret) => {
  const head = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}`;
  return `${head}.${createHmac('sha256', key).update(head).digest('base64url')}`;
};
const now = () => Math.floor(Date.now() / 1000);

let app: App;

const login = (email: string, password: string) =>
  app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
const tokenFor = async (email: string) => {
  const res = await login(email, demo);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<LoginBody>();
};
const get = (url: string, authorization?: string) =>
  app.inject({ method: 'GET', url, headers: authorization ? { authorization } : {} });
const bearer = (token: string) => `Bearer ${token}`;

beforeEach(async () => {
  app = await buildApp({ dbUrl: 'pglite:memory', jwtSecret: secret });
  await seed(app.db);
  app.get('/t/admin-or-editor', { preHandler: app.requireRole('admin', 'editor') }, () => ({
    ok: true,
  }));
  app.get('/t/who', { preHandler: app.authenticate }, (request) => request.user);
  await app.ready();
});
afterEach(() => app.close());

describe('auth', () => {
  it('Q-login-ok: seeded users log in and get a 15-minute HS256 token', async () => {
    for (const { email, role } of users) {
      const { token, user } = await tokenFor(email);
      expect(user).toMatchObject({ email, role });
      expect(typeof user.id).toBe('number');
      expect(token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
      const [header = '', payload = ''] = token.split('.');
      expect(decode(header)).toMatchObject({ alg: 'HS256' });
      const claims = decode(payload) as { sub: unknown; iat: number; exp: number };
      expect(claims).toMatchObject({ sub: user.id, role, email });
      expect(claims.exp - claims.iat).toBe(900);
    }
  });

  it('Q-login-401: wrong password and unknown email give identical 401 bodies', async () => {
    const wrong = await login('admin@lab.test', 'wrong-password');
    const unknown = await login('nobody@lab.test', demo);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: 'invalid_credentials' });
    expect(unknown.body).toBe(wrong.body);
  });

  it('Q-login-400: malformed bodies give invalid_body', async () => {
    const bodies: unknown[] = [
      {},
      { email: 'admin@lab.test' },
      { password: 'x' },
      { email: 'not-an-email', password: 'x' },
      { email: 'admin@lab.test', password: '' },
      [],
    ];
    for (const payload of bodies) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify(payload),
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json<{ error: string }>().error, JSON.stringify(payload)).toBe('invalid_body');
    }
  });

  it('Q-me-ok: /auth/me returns the logged-in user', async () => {
    const { token, user } = await tokenFor('editor@lab.test');
    const res = await get('/auth/me', bearer(token));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: { id: user.id, email: user.email, role: user.role } });
  });

  it('Q-me-401: missing, malformed, garbage and foreign-secret tokens are unauthorized', async () => {
    const { user } = await tokenFor('admin@lab.test');
    const foreign = sign(
      { sub: user.id, role: 'admin', email: user.email, iat: now(), exp: now() + 900 },
      'other-secret',
    );
    for (const header of [undefined, 'Bearer', 'Basic abc', 'Bearer garbage', bearer(foreign)]) {
      const res = await get('/auth/me', header);
      expect(res.statusCode, String(header)).toBe(401);
      expect(res.json(), String(header)).toEqual({ error: 'unauthorized' });
    }
  });

  it('Q-expired: a correctly signed but expired token is unauthorized', async () => {
    const { user } = await tokenFor('admin@lab.test');
    const expired = sign({
      sub: user.id,
      role: 'admin',
      email: user.email,
      iat: now() - 960,
      exp: now() - 60,
    });
    const res = await get('/auth/me', bearer(expired));
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthorized' });
  });

  it('Q-forged: an alg none token is unauthorized', async () => {
    const { user } = await tokenFor('admin@lab.test');
    const payload = {
      sub: user.id,
      role: 'admin',
      email: user.email,
      iat: now(),
      exp: now() + 900,
    };
    const none = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(payload)}.`;
    for (const url of ['/auth/me', '/t/who', '/t/admin-or-editor']) {
      const res = await get(url, bearer(none));
      expect(res.statusCode, url).toBe(401);
      expect(res.json(), url).toEqual({ error: 'unauthorized' });
    }
  });

  it('Q-deleted-user: a token for a deleted user is unauthorized on /auth/me', async () => {
    const { token, user } = await tokenFor('viewer@lab.test');
    await app.db.query('DELETE FROM orders');
    await app.db.query('DELETE FROM users WHERE id = $1', [user.id]);
    const res = await get('/auth/me', bearer(token));
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthorized' });
  });

  it('Q-no-hash: login and /auth/me never expose password hashes', async () => {
    const res = await login('admin@lab.test', demo);
    const me = await get('/auth/me', bearer(res.json<LoginBody>().token));
    for (const body of [res.body, me.body]) {
      expect(body).not.toContain('password_hash');
      expect(body).not.toContain('scrypt$');
    }
  });

  it('Q-role-guard: requireRole allows listed roles, 403 otherwise, 401 without token', async () => {
    for (const email of ['admin@lab.test', 'editor@lab.test']) {
      const res = await get('/t/admin-or-editor', bearer((await tokenFor(email)).token));
      expect(res.statusCode, email).toBe(200);
    }
    const viewer = await get(
      '/t/admin-or-editor',
      bearer((await tokenFor('viewer@lab.test')).token),
    );
    expect(viewer.statusCode).toBe(403);
    expect(viewer.json()).toEqual({ error: 'forbidden' });
    const anon = await get('/t/admin-or-editor');
    expect(anon.statusCode).toBe(401);
    expect(anon.json()).toEqual({ error: 'unauthorized' });
  });

  it('Q-authenticate: request.user carries sub, role and email', async () => {
    const { token, user } = await tokenFor('viewer@lab.test');
    const res = await get('/t/who', bearer(token));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ sub: user.id, role: user.role, email: user.email });
    const bad = await get('/t/who', 'Bearer garbage');
    expect(bad.statusCode).toBe(401);
    expect(bad.json()).toEqual({ error: 'unauthorized' });
  });
});

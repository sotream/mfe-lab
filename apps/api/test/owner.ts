// T47 test helpers. Everything secret is generated here at run time; nothing is a real credential.
import { createHmac, randomBytes } from 'node:crypto';
import { expect, onTestFinished, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { hashPassword } from '../src/password.ts';
import { seed } from '../src/seed.ts';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const b32encode = (buf: Buffer): string => {
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  return (bits.match(/.{1,5}/g) ?? []).map((c) => B32[parseInt(c.padEnd(5, '0'), 2)]).join('');
};
export const b32decode = (s: string): Buffer => {
  const bits = [...s].map((c) => B32.indexOf(c).toString(2).padStart(5, '0')).join('');
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
};

// Independent RFC 6238 reference (SHA1, 30 s step), so the product code is not checked against itself.
export const refTotp = (key: Buffer, atMs: number, digits = 6): string => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30_000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[19]! & 0xf;
  const n = (h.readUInt32BE(o) & 0x7fffffff) % 10 ** digits;
  return String(n).padStart(digits, '0');
};

export const OWNER_EMAIL = 'owner@test.invalid';
export type Owner = { email: string; password: string; key: Buffer; secret: string };

// Fresh random credentials, written to process.env for the rest of the test (vi.stubEnv, undone by the file's afterEach).
export const stubOwnerEnv = async (): Promise<Owner> => {
  const password = randomBytes(12).toString('base64url');
  const key = randomBytes(20);
  const secret = b32encode(key);
  vi.stubEnv('SUPERADMIN_EMAIL', OWNER_EMAIL);
  vi.stubEnv('SUPERADMIN_PASSWORD_HASH', await hashPassword(password));
  vi.stubEnv('SUPERADMIN_TOTP_SECRET', secret);
  return { email: OWNER_EMAIL, password, key, secret };
};

export const PROD_SECRET = 'x'.repeat(48); // >= 32 bytes

// ASSUMPTION: "API runs in production" = NODE_ENV=production AND VERCEL_ENV=production.
export const stubProd = () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VERCEL_ENV', 'production');
};
// ASSUMPTION: a PR preview is NODE_ENV=production with VERCEL_ENV=preview, and stays unlocked.
export const stubPreview = () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VERCEL_ENV', 'preview');
};

export const seededApp = async () => {
  const app = await buildApp({ dbUrl: 'pglite:memory', jwtSecret: PROD_SECRET, migrate: true });
  await seed(app.db);
  onTestFinished(() => app.close());
  return app;
};
export type App = Awaited<ReturnType<typeof seededApp>>;

export const loginReq = (app: App, email: string, password: string, otp?: string) =>
  app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: otp === undefined ? { email, password } : { email, password, otp },
  });

export const tokenOf = async (app: App, email: string, password = 'lab12345') => {
  const res = await loginReq(app, email, password); // demo-only seed password
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ token: string }>().token;
};
export const ownerToken = async (app: App, o: Owner, atMs = Date.now()) => {
  const res = await loginReq(app, o.email, o.password, refTotp(o.key, atMs));
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ token: string }>().token;
};

export const authed = (
  app: App,
  token: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });

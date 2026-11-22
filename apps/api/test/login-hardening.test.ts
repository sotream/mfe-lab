import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { authed, loginReq, PROD_SECRET, seededApp, stubProd, tokenOf } from './owner.ts';

afterEach(() => vi.unstubAllEnvs());

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const timeIt = async (run: () => Promise<unknown>) => {
  const t = performance.now();
  await run();
  return performance.now() - t;
};

describe('login hardening', () => {
  it('Q-login-hardening: the email lookup is case-insensitive', async () => {
    const app = await seededApp();
    for (const email of ['ADMIN@LAB.TEST', 'Admin@Lab.Test']) {
      const res = await loginReq(app, email, 'lab12345'); // demo-only seed password
      expect(res.statusCode, email).toBe(200);
      expect(res.json<{ user: { role: string } }>().user.role).toBe('admin');
    }
  });

  it('Q-login-hardening: an unknown email takes about as long as a wrong password (within 3x)', async () => {
    const app = await seededApp();
    const n = 4; // stays under the 10 per minute login limit
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < n; i++) {
      known.push(await timeIt(() => loginReq(app, 'admin@lab.test', 'wrong-password')));
      unknown.push(await timeIt(() => loginReq(app, `nobody${i}@lab.test`, 'wrong-password')));
    }
    expect(median(unknown)).toBeGreaterThan(median(known) / 3);
    expect(median(unknown)).toBeLessThan(median(known) * 3);
  });

  it('Q-login-hardening: the 11th login within a minute from one IP gets 429', async () => {
    const app = await seededApp();
    for (let i = 0; i < 10; i++) {
      expect(
        (await loginReq(app, 'viewer@lab.test', 'wrong-password')).statusCode,
        `try ${i + 1}`,
      ).toBe(401);
    }
    expect((await loginReq(app, 'viewer@lab.test', 'lab12345')).statusCode).toBe(429);
  });

  it('Q-login-hardening: authenticated writes are limited to 60 per minute per user', async () => {
    const app = await seededApp();
    const token = await tokenOf(app, 'admin@lab.test');
    for (let i = 0; i < 60; i++) {
      const res = await authed(app, token, 'PATCH', '/flags/products.crash', {
        enabled: i % 2 === 0,
      });
      expect(res.statusCode, `write ${i + 1}`).toBe(200);
    }
    expect(
      (await authed(app, token, 'PATCH', '/flags/products.crash', { enabled: true })).statusCode,
    ).toBe(429);
    // another user has their own budget
    const other = await tokenOf(app, 'editor@lab.test');
    const res = await authed(app, other, 'POST', '/products', {
      sku: 'RATE-0001',
      name: 'R',
      price_cents: 1,
      stock: 1,
    });
    expect(res.statusCode).toBe(201);
  });

  it('Q-login-hardening: POST /errors is limited to 30 per minute per IP', async () => {
    const app = await seededApp();
    const report = {
      remote: 'products',
      build: 'b1',
      kind: 'render',
      message: 'x',
      url: 'http://localhost/',
    };
    for (let i = 0; i < 30; i++) {
      expect(
        (await app.inject({ method: 'POST', url: '/errors', payload: report })).statusCode,
        `post ${i + 1}`,
      ).toBe(201);
    }
    expect((await app.inject({ method: 'POST', url: '/errors', payload: report })).statusCode).toBe(
      429,
    );
  });

  it('Q-login-hardening: production refuses to start with a JWT_SECRET under 32 bytes', async () => {
    stubProd();
    vi.stubEnv('JWT_SECRET', 'short-secret');
    await expect(buildApp({ dbUrl: 'pglite:memory', migrate: true })).rejects.toThrow();
    vi.stubEnv('JWT_SECRET', '');
    await expect(
      buildApp({ dbUrl: 'pglite:memory', migrate: true, jwtSecret: 'short-secret' }),
    ).rejects.toThrow();
  });

  it('Q-login-hardening: production starts with a 32-byte secret; a short one is fine outside production', async () => {
    stubProd();
    vi.stubEnv('JWT_SECRET', PROD_SECRET.slice(0, 32));
    const prod = await buildApp({ dbUrl: 'pglite:memory', migrate: true });
    await prod.close();
    vi.unstubAllEnvs();
    const dev = await buildApp({ dbUrl: 'pglite:memory', jwtSecret: 'test-secret' });
    await dev.close();
  });
});

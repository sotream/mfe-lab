import { describe, expect, it, vi } from 'vitest';
import { seed } from '../src/seed.ts';
import { authed, seededApp, tokenOf } from './owner.ts';

describe('reseed', () => {
  it('Q-reseed: flags go back to their defaults and errors are truncated', async () => {
    const app = await seededApp();
    const token = await tokenOf(app, 'admin@lab.test');
    const flagsOf = async () =>
      (
        await app.db.query<{ name: string; enabled: boolean }>(
          'select name, enabled from flags order by name',
        )
      ).map((f) => [f.name, f.enabled]);
    const defaults = await flagsOf();
    expect(defaults).toEqual([
      ['dashboard.revenue', true],
      ['products.crash', false],
      ['products.detailPage', true],
    ]);

    await authed(app, token, 'PATCH', '/flags/products.crash', { enabled: true });
    await authed(app, token, 'PATCH', '/flags/dashboard.revenue', { enabled: false });
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/errors',
        payload: {
          remote: 'orders',
          build: 'b1',
          kind: 'load',
          message: `m${i}`,
          url: 'http://localhost/',
        },
      });
      expect(res.statusCode).toBe(201);
    }
    expect(await flagsOf()).not.toEqual(defaults);

    await seed(app.db, { reset: true });
    expect(await flagsOf()).toEqual(defaults);
    expect(await app.db.query('select id from errors')).toEqual([]);
  });

  it('Q-reseed: the cron route does the same', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-test-secret-generated-in-test');
    try {
      const app = await seededApp();
      await app.db.query("update flags set enabled = true where name = 'products.crash'");
      await app.db.query(
        "insert into errors (remote, build, kind, message, url, at) values ('a','b','load','m','u', now())",
      );
      const res = await app.inject({
        method: 'GET',
        url: '/cron/reseed',
        headers: { authorization: 'Bearer cron-test-secret-generated-in-test' },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(await app.db.query('select id from errors')).toEqual([]);
      expect(
        await app.db.query("select name from flags where name = 'products.crash' and enabled"),
      ).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

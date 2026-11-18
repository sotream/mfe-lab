import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { seed } from '../src/seed.ts';
import { counts, tempDir, userVersion } from './helpers.ts';

const dir = tempDir();

describe('app', () => {
  it('Q-health: /health is ok, unknown route is 404', async () => {
    const app = await buildApp({ dbPath: ':memory:' });
    try {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
      expect((await app.inject({ method: 'GET', url: '/nope' })).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('Q-migrate-reopen: reopening an existing file keeps data and version', async () => {
    const dbPath = join(dir, 'app.db');
    const first = await buildApp({ dbPath });
    await seed(first.db);
    const version = userVersion(first.db);
    await first.close();

    const second = await buildApp({ dbPath });
    try {
      expect(userVersion(second.db)).toBe(version);
      expect(counts(second.db)).toEqual({ users: 3, products: 30, orders: 60 });
    } finally {
      await second.close();
    }
  });
});

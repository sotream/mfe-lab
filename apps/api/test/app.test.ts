import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { seed } from '../src/seed.ts';
import { counts, schemaVersions, tempDir } from './helpers.ts';

const dir = tempDir();

describe('app', () => {
  it('Q-health: /health is ok, unknown route is 404', async () => {
    const app = await buildApp({ dbUrl: 'pglite:memory' });
    try {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok', db: 'local' });
      expect((await app.inject({ method: 'GET', url: '/nope' })).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('Q-migrate-reopen: reopening an existing PGlite dir keeps data and version', async () => {
    const dbUrl = `pglite:${dir}`;
    const first = await buildApp({ dbUrl });
    await seed(first.db);
    const version = await schemaVersions(first.db);
    await first.close();

    const second = await buildApp({ dbUrl });
    try {
      expect(await schemaVersions(second.db)).toEqual(version);
      expect(await counts(second.db)).toEqual({ users: 3, products: 30, orders: 60 });
    } finally {
      await second.close();
    }
  });
});

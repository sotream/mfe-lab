// Q-function-entry and Q-no-pglite-in-prod, against the real entry apps/api/src/vercel.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from './function-entry.ts';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('JWT_SECRET', 'function-entry-test-secret-0123456789abcdef');
});
afterEach(() => vi.unstubAllEnvs());

describe('vercel function entry', () => {
  it('Q-function-entry: the entry exists and answers /health without a listening port', async () => {
    vi.stubEnv('DATABASE_URL', 'pglite:memory');
    const r = await invoke('/health');
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ status: 'ok', db: 'local' });
  });

  it('Q-function-entry: production does not migrate, an unmigrated database fails clearly', async () => {
    vi.stubEnv('DATABASE_URL', 'pglite:memory');
    // users table does not exist; a migrated empty db would answer 401 instead.
    const r = await invoke('/auth/login', {
      method: 'POST',
      payload: { email: 'admin@lab.test', password: 'lab12345' },
    });
    expect(r.statusCode).toBe(500);
  });

  it('Q-no-pglite-in-prod: a postgres:// URL never loads @electric-sql/pglite', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@127.0.0.1:1/db'); // pool is lazy, nothing connects
    let loaded = false;
    vi.doMock('@electric-sql/pglite', () => {
      loaded = true;
      return { PGlite: class {} };
    });
    // the import is what matters; a lazy pool never connects, and a failure here must show
    expect((await invoke('/health')).statusCode).toBe(500); // db unreachable, handler still answers
    expect(loaded).toBe(false);
  });
});

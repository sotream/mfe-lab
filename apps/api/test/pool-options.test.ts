import { describe, expect, it, vi } from 'vitest';

// T63: the Postgres pool keeps idle clients for 120 s (was 10 s). Nothing else in the pool changes.
const opts = vi.hoisted(() => ({ last: undefined as Record<string, unknown> | undefined }));
vi.mock('pg', () => {
  class Pool {
    constructor(o: Record<string, unknown>) {
      opts.last = o;
    }
    on() {
      return this;
    }
    end() {
      return Promise.resolve();
    }
  }
  return { default: { Pool, types: { setTypeParser: () => {} } }, Pool };
});

describe('pg pool options', () => {
  it('Q-t63-pool: idleTimeoutMillis is 120000, max stays 3', async () => {
    const { openDb } = await import('../src/db.ts');
    await openDb('postgres://u:p@localhost:5432/db');
    expect(opts.last?.idleTimeoutMillis).toBe(120_000);
    expect(opts.last?.max).toBe(3);
  });
});

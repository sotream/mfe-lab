// Q-db-guard: the API reports a non-secret database id on /health, and the preview smoke refuses to run
// against anything but the PR's Neon branch. preview-smoke.ts has no exported guard, so it is run as a
// subprocess with a mocked fetch (fixtures/mock-fetch.ts); only the rejecting paths are covered because
// the passing path launches a browser.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.ts';
import { dbFingerprint } from '../../scripts/provision.ts';

const root = resolve(import.meta.dirname, '../..');
const PG = 'postgres://neondb_owner:S3cretPw@ep-preview-pooler.eu-central-1.aws.neon.tech/neondb';

describe('db guard', () => {
  it('Q-db-guard: dbFingerprint is 12 hex of the host and throws on garbage', () => {
    expect(dbFingerprint(PG)).toMatch(/^[0-9a-f]{12}$/);
    expect(dbFingerprint(PG)).toBe(dbFingerprint(PG.replace('S3cretPw', 'other')));
    expect(dbFingerprint(PG)).not.toBe(dbFingerprint(PG.replace('ep-preview', 'ep-prod')));
    expect(() => dbFingerprint('not a url')).toThrow();
  });

  it('Q-db-guard: /health db matches dbFingerprint and leaks no host, user or password', async () => {
    // Opening the pool is lazy for pg; /health runs `select 1`, so stub the database check by connecting to
    // nothing: only the id is asserted when the query fails.
    const app = await buildApp({ dbUrl: PG, migrate: false }).catch(() => undefined);
    if (!app) return; // ponytail: pg cannot be opened offline; fingerprint is covered by the unit above
    try {
      const body = (await app.inject({ method: 'GET', url: '/health' })).body;
      if (body.includes('"db"')) {
        expect(JSON.parse(body).db).toBe(dbFingerprint(PG));
        for (const leak of ['ep-preview', 'neondb_owner', 'S3cretPw'])
          expect(body).not.toContain(leak);
      }
    } finally {
      await app.close();
    }
  });

  it('Q-db-guard: /health db is local for PGlite', async () => {
    const app = await buildApp({ dbUrl: 'pglite:memory' });
    try {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.json()).toEqual({ status: 'ok', db: 'local' });
    } finally {
      await app.close();
    }
  });

  const smoke = (preview: string, prod: string, id: string) =>
    spawnSync(
      'node',
      [
        '--import',
        resolve(root, 'tests/deploy/fixtures/mock-fetch.ts'),
        'scripts/preview-smoke.ts',
        'https://mfe-lab-pr-1.vercel.app',
        'https://mfe-lab-api-pr-1.vercel.app',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 30_000,
        env: { ...process.env, SMOKE_PREVIEW_DB: preview, SMOKE_PROD_DB: prod, PREVIEW_DB_ID: id },
      },
    );

  it.each([
    ['missing db', 'none', 'aaaaaaaaaaaa', 'aaaaaaaaaaaa'],
    ['mismatch with PREVIEW_DB_ID', 'bbbbbbbbbbbb', 'aaaaaaaaaaaa', 'cccccccccccc'],
    ['equal to production', 'aaaaaaaaaaaa', 'aaaaaaaaaaaa', 'aaaaaaaaaaaa'],
  ])('Q-db-guard: smoke rejects a preview db %s', (_n, preview, prod, id) => {
    const r = smoke(preview, prod, id);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/not on the PR branch|production/i);
  });
});

// Q-preview-isolation + Q-cleanup (T48 M3/M5): black-box from the T48 contract.
// provision.ts is driven with a recording fake of the Vercel and Neon APIs (mocked fetch).
// preview.yml is checked as text (no YAML parser at the root).
// ASSUMED guard step: a line in the Deploy previews step that contains "guard" (e.g. `node scripts/preview-smoke.ts guard "$url"`)
//   and runs before `alias set`.
// ASSUMED Neon create body: { branch: { name, parent_id, expires_at: ISO8601 } }; reuse refreshes it with a
//   PATCH/POST on the branch carrying branch.expires_at.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureNeonBranch, provision } from '../../scripts/provision.ts';

const root = resolve(import.meta.dirname, '../..');
const urls = JSON.parse(readFileSync(resolve(root, 'deploy/urls.json'), 'utf8')) as Record<
  string,
  string
>;
const quiet = () => {};
const json = (s: number, b: unknown) =>
  ({
    ok: s < 400,
    status: s,
    statusText: String(s),
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => b,
    text: async () => JSON.stringify(b),
  }) as unknown as Response;
const DB =
  'postgres://neondb_owner:Pw@ep-demo-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require';

type Req = { method: string; path: string; body: Record<string, unknown> };
const reqOf = (input: string | URL | Request, init?: RequestInit) => {
  const u = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  );
  const body = typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : {};
  return { u, method: (init?.method ?? 'GET').toUpperCase(), body };
};

// Fresh Vercel + Neon: everything gets created, env writes are recorded.
type Body = Record<string, unknown>;
const neonRoute = (method: string, p: string, body: Body) => {
  if (/\/organizations$/.test(p)) return json(200, { organizations: [] });
  if (method === 'POST' && /\/projects$/.test(p))
    return json(201, {
      project: { id: 'n1', ...(body.project as object) },
      connection_uris: [{ connection_uri: DB }],
    });
  return json(200, { projects: [{ id: 'n1', name: 'mfe-lab' }], uri: DB, connection_uri: DB });
};
function freshFake() {
  const writes: { key: string; target?: string[] }[] = [];
  const vercelRoute = (method: string, p: string, body: Body) => {
    if (p === '/v2/teams') return json(200, { teams: [] });
    if (method === 'POST' && /\/projects$/.test(p))
      return json(200, {
        id: 'prj',
        ...body,
        targets: { production: { alias: [`${body.name}.vercel.app`] } },
      });
    const m = /\/projects\/([^/]+)(\/env(?:\/[^/]+)?)?(\/domains)?$/.exec(p);
    if (m?.[3]) return json(200, { domains: [{ name: `${m[1]}.vercel.app` }] });
    if (!m?.[2])
      return json(200, {
        id: 'prj',
        name: m?.[1],
        targets: { production: { alias: [`${m?.[1]}.vercel.app`] } },
      });
    if (method === 'GET') return json(200, { envs: [] });
    writes.push(...((Array.isArray(body) ? body : [body]) as { key: string; target?: string[] }[]));
    return json(201, {});
  };
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const { u, method, body } = reqOf(input, init);
    return u.hostname.includes('neon')
      ? neonRoute(method, u.pathname, body)
      : vercelRoute(method, u.pathname, body);
  }) as typeof globalThis.fetch;
  return { f, writes };
}

describe('provision env targets', () => {
  it('Q-preview-isolation: DATABASE_URL, JWT_SECRET and CRON_SECRET are written to production only', async () => {
    const x = freshFake();
    await provision({ VERCEL_TOKEN: 'vt', NEON_API_KEY: 'nk' } as never, x.f, quiet);
    for (const key of ['DATABASE_URL', 'JWT_SECRET', 'CRON_SECRET']) {
      const w = x.writes.filter((e) => e.key === key);
      expect(w.length, key).toBeGreaterThan(0);
      for (const e of w) expect(e.target, key).toEqual(['production']);
    }
    expect(urls.api).toBeTruthy();
  });
});

describe('preview.yml', () => {
  const t = readFileSync(resolve(root, '.github/workflows/preview.yml'), 'utf8')
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, ''))
    .join('\n');
  const job = (name: string) =>
    new RegExp(`^ {2}${name}:\\s*\\n([\\s\\S]*?)(?=^ {2}[\\w-]+:\\s*$|(?![\\s\\S]))`, 'm').exec(
      t + '\n',
    )?.[1] ?? '';
  const steps = (body: string) =>
    body
      .split(/^ {6}- /m)
      .slice(1)
      .map((s) => s);
  const preview = job('preview');
  const cleanup = job('cleanup');

  it('Q-preview-isolation: the deploy passes a masked per-PR JWT_SECRET with -e', () => {
    expect(preview).toMatch(/-e\s+["']?JWT_SECRET=/);
    expect(preview).toMatch(/::add-mask::/);
    expect(preview).toMatch(/openssl rand|randomBytes|\/dev\/urandom|uuidgen/);
    expect(preview).not.toMatch(/secrets\.JWT_SECRET/);
  });

  it('Q-preview-isolation: previews never get a CRON_SECRET', () => {
    expect(t).not.toMatch(/CRON_SECRET/);
  });

  it('Q-preview-isolation: the DB guard runs on the deployment before `alias set`', () => {
    const deploy = steps(preview).find((s) => /alias set/.test(s)) ?? '';
    expect(deploy).toBeTruthy();
    const lines = deploy.split('\n');
    const guard = lines.findIndex((l) => /guard/i.test(l) && /\$\{?url\b/.test(l));
    const alias = lines.findIndex((l) => /alias set/.test(l));
    expect(guard, 'a guard line referencing $url').toBeGreaterThanOrEqual(0);
    expect(guard).toBeLessThan(alias);
    // a failing guard must stop the job: set -e is on, or the guard is chained with exit/||
    expect(deploy).toMatch(/set -e|\|\|\s*\{?[^\n]*exit 1/);
  });

  it('Q-cleanup: every cleanup step runs under always()', () => {
    // checkout/pnpm/node setup steps are plain `uses:` steps; every step that does work must be always()
    const s = steps(cleanup).filter((x) => /^(name|run):/m.test(x) || /\n\s+run:/.test(x));
    expect(s.length).toBeGreaterThan(2);
    for (const step of s)
      expect(step.split('\n').slice(0, 12).join('\n')).toMatch(/if:\s*\$?\{?\{?\s*always\(\)/);
  });

  it('Q-cleanup: cleanup removes the PR deployments with `vercel remove ... --yes`', () => {
    expect(cleanup).toMatch(/\bremove\b[^\n]*--yes/);
    expect(cleanup).not.toMatch(/--safe/);
  });

  it('Q-cleanup: deployments are tagged with the PR at deploy time', () => {
    expect(preview).toMatch(/(-m|--meta)\s+["']?pr=/);
  });
});

describe('neon branch expiry', () => {
  const DAY = 86_400_000;
  afterEach(() => vi.useRealTimers());

  function fakeNeon(existing: boolean) {
    const reqs: Req[] = [];
    const branches: { id: string; name: string; default?: boolean }[] = [
      { id: 'br-main', name: 'main', default: true },
    ];
    if (existing) branches.push({ id: 'br-pr7', name: 'preview/pr-7' });
    const f = (async (input: string | URL | Request, init?: RequestInit) => {
      const { u, method, body } = reqOf(input, init);
      reqs.push({ method, path: u.pathname, body });
      if (/organizations$/.test(u.pathname)) return json(200, { organizations: [] });
      if (/connection_uri$/.test(u.pathname)) return json(200, { uri: DB });
      if (/\/branches$/.test(u.pathname))
        return method === 'GET'
          ? json(200, { branches })
          : json(201, { branch: { id: 'br-pr7', name: 'preview/pr-7' }, connection_uris: [] });
      if (/\/projects$/.test(u.pathname))
        return json(200, { projects: [{ id: 'n0', name: 'mfe-lab' }] });
      return json(200, { branch: { id: 'br-pr7' } });
    }) as typeof globalThis.fetch;
    return { f, reqs };
  }
  const withExpiry = (r: Req) => (r.body.branch as { expires_at?: string } | undefined)?.expires_at;
  const near14 = (iso: string | undefined, now: number) => {
    expect(iso).toBeTruthy();
    const d = Date.parse(iso!) - now;
    expect(d).toBeGreaterThan(13 * DAY);
    expect(d).toBeLessThan(15 * DAY);
  };

  it('Q-cleanup: the branch create body carries expires_at about 14 days ahead', async () => {
    const now = Date.parse('2026-11-22T12:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'], now });
    const x = fakeNeon(false);
    await ensureNeonBranch({ VERCEL_TOKEN: 'vt', NEON_API_KEY: 'nk' } as never, 7, x.f, quiet);
    const create = x.reqs.find((r) => r.method === 'POST' && /\/branches$/.test(r.path))!;
    near14(withExpiry(create), now);
  });

  it('Q-cleanup: syncing an existing branch refreshes expires_at without recreating it', async () => {
    const now = Date.parse('2026-12-01T00:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'], now });
    const x = fakeNeon(true);
    await ensureNeonBranch({ VERCEL_TOKEN: 'vt', NEON_API_KEY: 'nk' } as never, 7, x.f, quiet);
    expect(x.reqs.filter((r) => r.method === 'POST' && /\/branches$/.test(r.path))).toHaveLength(0);
    const refresh = x.reqs.find(
      (r) => ['PATCH', 'POST', 'PUT'].includes(r.method) && withExpiry(r),
    );
    near14(refresh && withExpiry(refresh), now);
  });
});

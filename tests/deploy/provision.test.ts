// Q-provision: scripts/provision.ts against an in-memory fake of the Vercel and Neon APIs.
// ASSUMPTIONS (phase 2 adjusts):
//  - scripts/provision.ts exports `async provision({ fetch, env, log })`; it rejects on failure;
//  - env carries VERCEL_TOKEN and NEON_API_KEY;
//  - it reads deploy/urls.json itself (cwd = repo root).
// All URL/payload knowledge lives in `makeFake().route` below; adapt only that helper.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { provision } from '../../scripts/provision.ts';

const root = resolve(import.meta.dirname, '../..');
const urls = JSON.parse(readFileSync(resolve(root, 'deploy/urls.json'), 'utf8')) as Record<
  string,
  string
>;
// Vercel project name -> app dir, derived from the production URLs.
const expectedProjects = Object.entries(urls).map(([dir, u]) => ({
  dir,
  name: new URL(u).hostname.replace(/\.vercel\.app$/, ''),
}));
const DB_URI =
  'postgres://neondb_owner:S3cretNeonPw@ep-demo-pooler.eu-central-1.aws.neon.tech/neondb';
const DB_URI_NEW =
  'postgres://neondb_owner:An0therPw@ep-demo-pooler.eu-central-1.aws.neon.tech/neondb';

type Env = { key: string; value: string; type?: string; target?: string[] };
type VProject = {
  id: string;
  name: string;
  framework?: string | null;
  rootDirectory?: string;
  nodeVersion?: string;
  domain: string;
  envs: Env[];
};
type Body = Record<string, unknown>;
type NProject = { id: string; name: string; region_id: string; pg_version: number };

function makeFake(opts: { dbUri?: string; domainFor?: (name: string) => string } = {}) {
  const st = {
    neon: [] as NProject[],
    vercel: new Map<string, VProject>(),
    dbUri: opts.dbUri ?? DB_URI,
    creates: [] as string[], // 'neon' | 'vercel:<name>'
    envWrites: [] as {
      project: string;
      key: string;
      value: string;
      type?: string;
      target?: string[];
    }[],
    calls: [] as string[],
  };
  let n = 0;
  const json = (status: number, body: unknown) =>
    ({
      ok: status < 400,
      status,
      statusText: String(status),
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => body,
      text: async () => JSON.stringify(body),
    }) as unknown as Response;

  // ---- the only place that knows endpoints and payload shapes ----
  const neonRoute = (method: string, p: string, body: Body): Response => {
    if (method === 'POST' && /\/projects$/.test(p)) {
      const pr = body.project as NProject;
      const rec = {
        id: `neon-${++n}`,
        name: pr.name,
        region_id: pr.region_id,
        pg_version: pr.pg_version,
      };
      st.neon.push(rec);
      st.creates.push('neon');
      return json(201, { project: rec, connection_uris: [{ connection_uri: st.dbUri }] });
    }
    return json(200, { projects: st.neon, uri: st.dbUri, connection_uri: st.dbUri });
  };
  const envRoute = (
    method: string,
    proj: VProject,
    id: string | undefined,
    body: Body,
  ): Response => {
    // ASSUMPTION: the fake returns env values so "unchanged" is detectable (real Vercel hides sensitive ones).
    if (method === 'GET')
      return json(200, { envs: proj.envs.map((e, i) => ({ id: `env_${i}`, ...e })) });
    if (method === 'POST') {
      for (const e of (Array.isArray(body) ? body : [body]) as Env[]) {
        proj.envs = proj.envs.filter((x) => x.key !== e.key);
        proj.envs.push(e);
        st.envWrites.push({ project: proj.name, ...e });
      }
      return json(201, {});
    }
    if (method === 'PATCH') {
      const e = proj.envs[Number(/env_(\d+)/.exec(id ?? '')?.[1])];
      if (e) Object.assign(e, body);
      st.envWrites.push({
        project: proj.name,
        key: e?.key ?? '',
        ...(body as Partial<Env>),
      } as never);
    }
    return json(200, {});
  };
  const vercelRoute = (method: string, p: string, body: Body): Response => {
    if (method === 'GET' && /\/projects$/.test(p))
      return json(200, { projects: [...st.vercel.values()] });
    if (method === 'POST' && /\/projects$/.test(p)) {
      const name = body.name as string;
      const rec: VProject = {
        id: `prj_${++n}`,
        name,
        framework: body.framework as string | null,
        rootDirectory: body.rootDirectory as string,
        nodeVersion: body.nodeVersion as string,
        domain: opts.domainFor?.(name) ?? `${name}.vercel.app`,
        envs: [],
      };
      st.vercel.set(name, rec);
      st.creates.push(`vercel:${name}`);
      return json(200, withDomain(rec));
    }
    const m = /\/projects\/([^/]+)(\/env(?:\/([^/]+))?)?(\/domains)?$/.exec(p);
    const proj = [...st.vercel.values()].find((x) => x.name === m?.[1] || x.id === m?.[1]);
    if (!m || !proj) return json(404, { error: { code: 'not_found' } });
    if (m[4]) return json(200, { domains: [{ name: proj.domain }] });
    return m[2] ? envRoute(method, proj, m[3], body) : json(200, withDomain(proj));
  };
  const withDomain = (r: VProject) => ({
    ...r,
    targets: { production: { alias: [r.domain] } },
    alias: [{ domain: r.domain }],
  });
  const route = (method: string, u: URL, body: Body): Response =>
    u.hostname.includes('neon')
      ? neonRoute(method, u.pathname, body)
      : vercelRoute(method, u.pathname, body);

  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: Body = {};
    if (typeof init?.body === 'string' && init.body) body = JSON.parse(init.body);
    st.calls.push(`${method} ${u.pathname}`);
    return route(method, u, body);
  };
  return { st, fetch: fetch as typeof globalThis.fetch };
}

// Seed helpers for the "everything exists" scenario.
const seedAll = (f: ReturnType<typeof makeFake>, dbValue = DB_URI) => {
  f.st.neon.push({ id: 'neon-0', name: 'mfe-lab', region_id: 'aws-eu-central-1', pg_version: 17 });
  for (const { dir, name } of expectedProjects) {
    f.st.vercel.set(name, {
      id: `prj_${name}`,
      name,
      framework: null,
      rootDirectory: `apps/${dir}`,
      domain: `${name}.vercel.app`,
      envs:
        dir === 'api'
          ? ['production', 'preview'].flatMap((t) => [
              { key: 'DATABASE_URL', value: dbValue, type: 'sensitive', target: [t] },
              { key: 'JWT_SECRET', value: 'x'.repeat(48), type: 'sensitive', target: [t] },
              { key: 'CRON_SECRET', value: 'y'.repeat(48), type: 'sensitive', target: [t] },
            ])
          : [],
    });
  }
  f.st.creates.length = 0;
  f.st.envWrites.length = 0;
  f.st.calls.length = 0;
};

const run = (f: ReturnType<typeof makeFake>) => {
  const logs: string[] = [];
  const out: string[] = [];
  const w = (c: unknown) => (out.push(String(c)), true);
  const so = vi.spyOn(process.stdout, 'write').mockImplementation(w as never);
  const se = vi.spyOn(process.stderr, 'write').mockImplementation(w as never);
  vi.spyOn(console, 'log').mockImplementation((...a) => void out.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a) => void out.push(a.join(' ')));
  const env = {
    VERCEL_TOKEN: 'vtok_' + randomBytes(8).toString('hex'),
    NEON_API_KEY: 'nkey_' + randomBytes(8).toString('hex'),
  };
  const done = provision({
    fetch: f.fetch,
    env,
    log: (...a: unknown[]) => void logs.push(a.join(' ')),
  } as never);
  return { done, logs, out, env, so, se };
};
afterEach(() => vi.restoreAllMocks());

const apiEnv = (f: ReturnType<typeof makeFake>) => f.st.vercel.get('mfe-lab-api')!.envs;
const valueOf = (f: ReturnType<typeof makeFake>, key: string) =>
  apiEnv(f).find((e) => e.key === key)?.value;

describe('provision', () => {
  it('Q-provision: fresh accounts get a Neon project and four Vercel projects', async () => {
    const f = makeFake();
    const r = run(f);
    await r.done;

    expect(f.st.neon).toHaveLength(1);
    expect(f.st.neon[0]).toMatchObject({
      name: 'mfe-lab',
      region_id: 'aws-eu-central-1',
      pg_version: 17,
    });

    expect([...f.st.vercel.keys()].sort()).toEqual([
      'mfe-lab',
      'mfe-lab-api',
      'mfe-lab-dashboard',
      'mfe-lab-products',
    ]);
    for (const { dir, name } of expectedProjects) {
      const p = f.st.vercel.get(name)!;
      expect(p.rootDirectory, name).toBe(`apps/${dir}`);
      expect(p.framework ?? null, name).toBeNull();
      expect(p.nodeVersion, name).toMatch(/^26/);
    }
    expect(f.st.creates).toHaveLength(5);
  });

  it('Q-provision: fresh run sets DATABASE_URL, JWT_SECRET, CRON_SECRET on api only, as sensitive, prod + preview', async () => {
    const f = makeFake();
    await run(f).done;

    for (const [name, p] of f.st.vercel) {
      if (name !== 'mfe-lab-api') expect(p.envs, name).toEqual([]);
    }
    const keys = new Set(apiEnv(f).map((e) => e.key));
    expect(keys).toEqual(new Set(['DATABASE_URL', 'JWT_SECRET', 'CRON_SECRET']));
    for (const e of apiEnv(f)) {
      expect(e.type, e.key).toBe('sensitive');
      expect(e.target ?? [], e.key).toEqual(expect.arrayContaining(['production', 'preview']));
    }
    expect(valueOf(f, 'DATABASE_URL')).toBe(DB_URI);
    expect(valueOf(f, 'JWT_SECRET')!.length).toBeGreaterThanOrEqual(32);
    expect(valueOf(f, 'CRON_SECRET')!.length).toBeGreaterThanOrEqual(32);
    expect(valueOf(f, 'JWT_SECRET')).not.toBe(valueOf(f, 'CRON_SECRET'));
  });

  it('Q-provision: everything existing -> no creates, secrets untouched', async () => {
    const f = makeFake();
    seedAll(f);
    await run(f).done;

    expect(f.st.creates).toEqual([]);
    expect(f.st.envWrites.filter((w) => w.key !== 'DATABASE_URL')).toEqual([]);
    expect(valueOf(f, 'JWT_SECRET')).toBe('x'.repeat(48));
    expect(valueOf(f, 'CRON_SECRET')).toBe('y'.repeat(48));
  });

  it('Q-provision: unchanged DATABASE_URL is not rewritten', async () => {
    const f = makeFake();
    seedAll(f);
    await run(f).done;
    expect(f.st.envWrites).toEqual([]);
  });

  it('Q-provision: a changed Neon URI updates DATABASE_URL but still rotates nothing else', async () => {
    const f = makeFake({ dbUri: DB_URI_NEW });
    seedAll(f, DB_URI);
    await run(f).done;

    expect(f.st.creates).toEqual([]);
    expect(valueOf(f, 'DATABASE_URL')).toBe(DB_URI_NEW);
    expect(valueOf(f, 'JWT_SECRET')).toBe('x'.repeat(48));
    expect(valueOf(f, 'CRON_SECRET')).toBe('y'.repeat(48));
  });

  it('Q-provision: a second run changes nothing', async () => {
    const f = makeFake();
    await run(f).done;
    const snap = JSON.stringify([f.st.neon, [...f.st.vercel.values()]]);
    f.st.creates.length = 0;
    vi.restoreAllMocks();
    await run(f).done;
    expect(f.st.creates).toEqual([]);
    expect(JSON.stringify([f.st.neon, [...f.st.vercel.values()]])).toBe(snap);
  });

  it('Q-provision: a wrong production domain fails and names the actual domain', async () => {
    const f = makeFake({
      domainFor: (n) =>
        n === 'mfe-lab-products' ? 'mfe-lab-products-abc123.vercel.app' : `${n}.vercel.app`,
    });
    const r = run(f);
    await expect(r.done).rejects.toThrow(/mfe-lab-products-abc123\.vercel\.app/);
  });

  it('Q-provision: logs, stdout and stderr never contain secrets or the DB URI', async () => {
    const f = makeFake();
    const r = run(f);
    await r.done;
    const everything = [...r.logs, ...r.out].join('\n');
    expect(everything.length).toBeGreaterThan(0); // it does report names / created / exists
    const secrets = [
      valueOf(f, 'JWT_SECRET')!,
      valueOf(f, 'CRON_SECRET')!,
      DB_URI,
      'S3cretNeonPw',
      r.env.VERCEL_TOKEN,
      r.env.NEON_API_KEY,
    ];
    for (const s of secrets) expect(everything, s.slice(0, 6)).not.toContain(s);
  });

  it('Q-provision: failure messages do not leak secrets either', async () => {
    const f = makeFake({ domainFor: () => 'wrong.vercel.app' });
    const r = run(f);
    const err = await r.done.then(
      () => null,
      (e: Error) => e,
    );
    expect(err).not.toBeNull();
    const everything = [String(err?.message), ...r.logs, ...r.out].join('\n');
    for (const s of [DB_URI, 'S3cretNeonPw', r.env.VERCEL_TOKEN, r.env.NEON_API_KEY]) {
      expect(everything).not.toContain(s);
    }
  });
});

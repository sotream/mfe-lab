// Q-provision-branch: Neon branch lifecycle in scripts/provision.ts against a fake Neon (mocked fetch).
// ASSUMED exports of scripts/provision.ts:
//   previewBranchName(pr) -> 'preview/pr-<n>'
//   ensureNeonBranch(env, pr, fetch, log) -> normalized (sslmode=verify-full) DATABASE_URL of the branch; idempotent
//   deleteNeonBranch(env, pr, fetch, log) -> void; a missing branch is a no-op
// Fake endpoints follow the Neon API v2: /projects, /projects/{id}/branches, DELETE .../branches/{bid},
// connection_uri?branch_id=...
import { describe, expect, it } from 'vitest';
import { deleteNeonBranch, ensureNeonBranch, previewBranchName } from '../../scripts/provision.ts';

type Branch = { id: string; name: string; default?: boolean; primary?: boolean };
const env = { VERCEL_TOKEN: 'vt', NEON_API_KEY: 'nk' } as never;
const quiet = () => {};
const HOST = 'ep-demo-pooler.eu-central-1.aws.neon.tech/neondb';

function fake(opts: { existing?: string[]; createStatus?: number } = {}) {
  const branches: Branch[] = [{ id: 'br-main', name: 'main', default: true, primary: true }];
  for (const n of opts.existing ?? []) branches.push({ id: `br-${n.replace(/\W/g, '')}`, name: n });
  const reqs: {
    method: string;
    path: string;
    search: URLSearchParams;
    body: { branch?: { name: string; parent_id?: string } };
  }[] = [];
  const json = (s: number, b: unknown) =>
    ({
      ok: s < 400,
      status: s,
      json: async () => b,
      text: async () => JSON.stringify(b),
    }) as Response;
  const create = (body: { branch?: { name: string } }): Response => {
    if (opts.createStatus) return json(opts.createStatus, { message: 'branch limit exceeded' });
    const name = body.branch!.name;
    branches.push({ id: `br-${name.replace(/\W/g, '')}`, name });
    return json(201, {
      branch: { id: `br-${name.replace(/\W/g, '')}`, name },
      connection_uris: [],
    });
  };
  const remove = (id: string): Response => {
    const i = branches.findIndex((b) => b.id === id);
    if (i < 0) return json(404, { message: 'not found' });
    branches.splice(i, 1);
    return json(200, {});
  };
  const route = (method: string, p: string, body: { branch?: { name: string } }): Response => {
    if (/\/users\/me\/organizations$/.test(p)) return json(200, { organizations: [] });
    if (/connection_uri$/.test(p))
      return json(200, {
        uri: `postgres://neondb_owner:Pw@${HOST}?sslmode=require&channel_binding=require`,
      });
    if (/\/branches$/.test(p)) return method === 'GET' ? json(200, { branches }) : create(body);
    if (method === 'DELETE') return remove(p.split('/').pop()!);
    if (/\/projects$/.test(p)) return json(200, { projects: [{ id: 'neon-0', name: 'mfe-lab' }] });
    return json(200, {});
  };
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : {};
    reqs.push({ method, path: u.pathname, search: u.searchParams, body });
    return route(method, u.pathname, body);
  }) as typeof globalThis.fetch;
  return { f, reqs, branches };
}
const posts = (x: ReturnType<typeof fake>) =>
  x.reqs.filter((r) => r.method === 'POST' && /\/branches$/.test(r.path));
const deletes = (x: ReturnType<typeof fake>) => x.reqs.filter((r) => r.method === 'DELETE');

describe('preview branch', () => {
  it('Q-provision-branch: the name for PR n is preview/pr-<n>', () => {
    expect(previewBranchName(7)).toBe('preview/pr-7');
    expect(previewBranchName(1234)).toBe('preview/pr-1234');
  });

  it('Q-provision-branch: creates the branch under the default branch and returns a verify-full URL', async () => {
    const x = fake();
    const url = await ensureNeonBranch(env, 7, x.f, quiet);
    expect(posts(x)).toHaveLength(1);
    const b = posts(x)[0]!.body;
    expect(b.branch!.name).toBe('preview/pr-7');
    expect(b.branch!.parent_id).toBe('br-main');
    expect(x.branches.map((r) => r.name)).toContain('preview/pr-7');
    expect(new URL(url).searchParams.get('sslmode')).toBe('verify-full');
    expect(url).toContain(HOST);
  });

  it('Q-provision-branch: an existing branch is reused, not recreated', async () => {
    const x = fake({ existing: ['preview/pr-7'] });
    const url = await ensureNeonBranch(env, 7, x.f, quiet);
    expect(posts(x)).toHaveLength(0);
    expect(new URL(url).searchParams.get('sslmode')).toBe('verify-full');
    await ensureNeonBranch(env, 7, x.f, quiet);
    expect(posts(x)).toHaveLength(0);
  });

  it('Q-provision-branch: running twice on a fresh project creates exactly one branch', async () => {
    const x = fake();
    await ensureNeonBranch(env, 9, x.f, quiet);
    await ensureNeonBranch(env, 9, x.f, quiet);
    expect(posts(x)).toHaveLength(1);
  });

  it('Q-provision-branch: a creation failure rejects with a clear message and no secrets', async () => {
    const x = fake({ createStatus: 422 });
    const err = await ensureNeonBranch(env, 7, x.f, quiet).then(
      () => undefined,
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toMatch(/branch|422/i);
    expect(err!.message).not.toContain('nk');
  });

  it('Q-provision-branch: deleting removes only that PR branch', async () => {
    const x = fake({ existing: ['preview/pr-7', 'preview/pr-8'] });
    await deleteNeonBranch(env, 7, x.f, quiet);
    expect(deletes(x)).toHaveLength(1);
    expect(x.branches.map((b) => b.name).sort()).toEqual(['main', 'preview/pr-8']);
  });

  it('Q-provision-branch: deleting a missing branch is a no-op, never touches main', async () => {
    const x = fake();
    await expect(deleteNeonBranch(env, 99, x.f, quiet)).resolves.toBeUndefined();
    expect(deletes(x)).toHaveLength(0);
    expect(x.branches.map((b) => b.name)).toEqual(['main']);
  });
});

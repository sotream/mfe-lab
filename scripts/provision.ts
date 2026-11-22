// One-time (idempotent) provisioning: a Neon project and a Vercel project per entry of deploy/urls.json, plus the API env.
// Runs in GitHub Actions (provision.yml) with VERCEL_TOKEN and NEON_API_KEY. Plain fetch, no SDK.
// Logs only names, ids and created/exists/updated, never a secret or the database URI.
//   node scripts/provision.ts           provision
//   node scripts/provision.ts db-url    mask the pooled Neon URI and export it as DATABASE_URL (GITHUB_ENV)
//   node scripts/provision.ts vercel-scope  print the Vercel team slug (empty for a personal account)
//   node scripts/provision.ts preview-db <pr>         find or create Neon branch preview/pr-<pr>, export its URI as DATABASE_URL
//   node scripts/provision.ts preview-db-delete <pr>  delete that branch (no-op when missing)
// The Vercel team and the Neon organization are discovered from the tokens; nothing is stored.
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

const NEON = 'https://console.neon.tech/api/v2';
const VERCEL = 'https://api.vercel.com';
const NEON_PROJECT = 'mfe-lab';
const DB = 'neondb'; // Neon defaults for a new project
const ROLE = 'neondb_owner';
const TARGETS = ['production', 'preview']; // sensitive vars cannot target "development"

const urlsFile = join(import.meta.dirname, '..', 'deploy', 'urls.json');

async function call(f: Fetch, token: string, method: string, url: string, body?: unknown) {
  const res = await f(url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // Status and path only: error bodies may echo values.
  if (res.status === 404 && method === 'GET') return undefined;
  if (!res.ok) throw new Error(`${method} ${new URL(url).pathname} failed: HTTP ${res.status}`);
  return (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

type Vercel = (method: string, url: string, body?: unknown) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// The Vercel team of the token: none (personal account) or the only one; several is ambiguous.
export async function vercelScope(env: Env, f: Fetch = fetch) {
  const r = await call(f, env.VERCEL_TOKEN!, 'GET', `${VERCEL}/v2/teams`);
  const teams: { id: string; slug: string }[] = r?.teams ?? [];
  if (teams.length > 1)
    throw new Error(`several Vercel teams: ${teams.map((t) => t.slug).join(', ')}`);
  return teams[0] as { id: string; slug: string } | undefined;
}

// Every Vercel call carries teamId when the token belongs to a team.
async function vercelClient(env: Env, f: Fetch): Promise<Vercel> {
  const id = (await vercelScope(env, f))?.id;
  return (method, url, body) =>
    call(
      f,
      env.VERCEL_TOKEN!,
      method,
      id ? `${url}${url.includes('?') ? '&' : '?'}teamId=${id}` : url,
      body,
    );
}

// The Neon organization of the key: none or the only one; several is ambiguous.
async function neonOrg(f: Fetch, key: string) {
  const r = await call(f, key, 'GET', `${NEON}/users/me/organizations`);
  const orgs: { id: string }[] = r?.organizations ?? [];
  if (orgs.length > 1) throw new Error(`several Neon orgs: ${orgs.map((o) => o.id).join(', ')}`);
  return orgs[0]?.id as string | undefined;
}

// The pooled URI of the mfe-lab Neon project (created if missing). Never logged.
async function neonProject(env: Env, f: Fetch, log: (s: string) => void) {
  const key = env.NEON_API_KEY!;
  const org = await neonOrg(f, key);
  const found = await call(
    f,
    key,
    'GET',
    `${NEON}/projects?search=${NEON_PROJECT}&limit=100${org ? `&org_id=${org}` : ''}`,
  );
  let project = found.projects.find((p: { name: string }) => p.name === NEON_PROJECT);
  if (project) log(`neon ${NEON_PROJECT} ${project.id}: exists`);
  else {
    const created = await call(f, key, 'POST', `${NEON}/projects`, {
      project: { name: NEON_PROJECT, region_id: 'aws-eu-central-1', pg_version: 17, org_id: org },
    });
    project = created.project;
    log(`neon ${NEON_PROJECT} ${project.id}: created`);
  }
  return project.id as string;
}

// Pooled URI of a database/role (of a branch when given). pg warns on sslmode=require (alias of verify-full today,
// weaker in pg v9); Neon certs are publicly trusted, so pin verify-full.
async function neonUri(f: Fetch, key: string, project: string, branchId?: string) {
  const q = `database_name=${DB}&role_name=${ROLE}&pooled=true${branchId ? `&branch_id=${branchId}` : ''}`;
  const { uri } = await call(f, key, 'GET', `${NEON}/projects/${project}/connection_uri?${q}`);
  const url = new URL(uri);
  url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}

export async function neonDatabaseUrl(
  env: Env,
  f: Fetch = fetch,
  log: (s: string) => void = console.log,
) {
  return neonUri(f, env.NEON_API_KEY!, await neonProject(env, f, log));
}

// First 12 hex of sha256 of the database host: what the API reports as /health db (apps/api/src/app.ts has a copy).
export const dbFingerprint = (url: string) =>
  createHash('sha256').update(new URL(url).hostname).digest('hex').slice(0, 12);

export const previewBranchName = (pr: number | string) => `preview/pr-${pr}`;

type Branch = { id: string; name: string; default?: boolean };
async function neonBranches(f: Fetch, key: string, project: string) {
  const r = await call(f, key, 'GET', `${NEON}/projects/${project}/branches?limit=100`);
  return (r?.branches ?? []) as Branch[];
}

// The pooled URI of branch preview/pr-<pr>, created from the default branch when missing (reused otherwise).
// Throws when Neon refuses (for example the free-tier branch limit).
export async function ensureNeonBranch(
  env: Env,
  pr: number | string,
  f: Fetch = fetch,
  log: (s: string) => void = console.log,
) {
  const key = env.NEON_API_KEY!;
  const project = await neonProject(env, f, log);
  const name = previewBranchName(pr);
  const branches = await neonBranches(f, key, project);
  let branch = branches.find((b) => b.name === name);
  if (branch) log(`neon branch ${name}: exists`);
  else {
    const parent = branches.find((b) => b.default);
    if (!parent) throw new Error('neon: no default branch to branch from');
    const created = await call(f, key, 'POST', `${NEON}/projects/${project}/branches`, {
      branch: { name, parent_id: parent.id },
      endpoints: [{ type: 'read_write' }],
    });
    branch = created.branch as Branch;
    log(`neon branch ${name}: created`);
  }
  return neonUri(f, key, project, branch.id);
}

export async function deleteNeonBranch(
  env: Env,
  pr: number | string,
  f: Fetch = fetch,
  log: (s: string) => void = console.log,
) {
  const key = env.NEON_API_KEY!;
  const project = await neonProject(env, f, log);
  const name = previewBranchName(pr);
  const branch = (await neonBranches(f, key, project)).find((b) => b.name === name);
  if (!branch) return log(`neon branch ${name}: already gone`);
  await call(f, key, 'DELETE', `${NEON}/projects/${project}/branches/${branch.id}`);
  log(`neon branch ${name}: deleted`);
}

async function vercelProject(v: Vercel, name: string, dir: string, log: (s: string) => void) {
  const p = `${VERCEL}/v9/projects/${name}`;
  if (await v('GET', p)) return log(`vercel ${name}: exists`);
  await v('POST', `${VERCEL}/v11/projects`, {
    name,
    framework: null,
    rootDirectory: `apps/${dir}`,
  });
  // nodeVersion is not accepted on create.
  await v('PATCH', p, { nodeVersion: '26.x' });
  log(`vercel ${name}: created`);
}

async function checkDomain(v: Vercel, name: string) {
  const r = await v('GET', `${VERCEL}/v9/projects/${name}/domains?production=true`);
  const domains: string[] = (r?.domains ?? []).map((d: { name: string }) => d.name);
  // ponytail: an empty list (no production domain assigned yet) passes; the deploy smoke step catches a wrong URL.
  if (domains.length && !domains.includes(`${name}.vercel.app`))
    throw new Error(
      `${name}: production domain is ${domains.join(', ')}, expected ${name}.vercel.app. Update deploy/urls.json and rerun node scripts/vercel-config.ts.`,
    );
}

// Sensitive values cannot be read back, so DATABASE_URL carries a hash of itself in its comment.
const fingerprint = (v: string) =>
  `sha256:${createHash('sha256').update(v).digest('hex').slice(0, 16)}`;

async function setEnv(
  vc: Vercel,
  project: string,
  existing: { id: string; key: string; value?: string; comment?: string }[],
  key: string,
  value: () => string,
  rotate: boolean,
  log: (s: string) => void,
) {
  const cur = existing.find((e) => e.key === key);
  const base = `${VERCEL}/v10/projects/${project}/env`;
  if (!cur) {
    const v = value();
    const r = await vc('POST', base, {
      key,
      value: v,
      type: 'sensitive',
      target: TARGETS,
      comment: rotate ? fingerprint(v) : undefined,
    });
    if (r.failed?.length) throw new Error(`${project} ${key}: create failed`);
    return log(`vercel ${project} env ${key}: created`);
  }
  if (!rotate) return log(`vercel ${project} env ${key}: exists`);
  const v = value();
  if (cur.value === v || cur.comment === fingerprint(v))
    return log(`vercel ${project} env ${key}: exists`);
  await vc('PATCH', `${VERCEL}/v9/projects/${project}/env/${cur.id}`, {
    value: v,
    type: 'sensitive',
    target: TARGETS,
    comment: fingerprint(v),
  });
  log(`vercel ${project} env ${key}: updated`);
}

export async function provision(
  env: Env,
  f: Fetch = fetch,
  log: (s: string) => void = console.log,
) {
  const token = env.VERCEL_TOKEN;
  if (!token || !env.NEON_API_KEY) throw new Error('VERCEL_TOKEN and NEON_API_KEY are required');
  const urls: Record<string, string> = JSON.parse(readFileSync(urlsFile, 'utf8'));
  const names = Object.fromEntries(
    Object.entries(urls).map(([dir, u]) => [
      dir,
      new URL(u).hostname.replace(/\.vercel\.app$/, ''),
    ]),
  );

  const vc = await vercelClient(env, f);
  const dbUrl = await neonDatabaseUrl(env, f, log);
  for (const [dir, name] of Object.entries(names)) {
    await vercelProject(vc, name, dir, log);
    await checkDomain(vc, name);
  }

  const api = names.api!;
  const list = await vc('GET', `${VERCEL}/v10/projects/${api}/env`);
  const existing = list.envs ?? list;
  const random = () => randomBytes(32).toString('base64url');
  await setEnv(vc, api, existing, 'DATABASE_URL', () => dbUrl, true, log);
  await setEnv(vc, api, existing, 'JWT_SECRET', random, false, log);
  await setEnv(vc, api, existing, 'CRON_SECRET', random, false, log);
}

if (import.meta.main) {
  try {
    if (process.argv[2] === 'db-url') {
      const uri = await neonDatabaseUrl(process.env, fetch, () => {});
      console.log(`::add-mask::${uri}`);
      appendFileSync(process.env.GITHUB_ENV!, `DATABASE_URL=${uri}\n`);
    } else if (process.argv[2] === 'preview-db') {
      const uri = await ensureNeonBranch(process.env, process.argv[3]!);
      console.log(`::add-mask::${uri}`);
      appendFileSync(
        process.env.GITHUB_ENV!,
        `DATABASE_URL=${uri}\nPREVIEW_DB_ID=${dbFingerprint(uri)}\n`,
      );
    } else if (process.argv[2] === 'preview-db-delete') {
      await deleteNeonBranch(process.env, process.argv[3]!);
    } else if (process.argv[2] === 'vercel-scope') {
      console.log((await vercelScope(process.env))?.slug ?? '');
    } else await provision(process.env);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

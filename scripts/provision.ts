// One-time (idempotent) provisioning: a Neon project and the four Vercel projects, plus the API env.
// Runs in GitHub Actions (provision.yml) with VERCEL_TOKEN and NEON_API_KEY. Plain fetch, no SDK.
// Logs only names, ids and created/exists/updated, never a secret or the database URI.
//   node scripts/provision.ts           provision
//   node scripts/provision.ts db-url    mask the pooled Neon URI and export it as DATABASE_URL (GITHUB_ENV)
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

// The pooled URI of the mfe-lab Neon project (created if missing). Never logged.
async function neonProject(env: Env, f: Fetch, log: (s: string) => void) {
  const key = env.NEON_API_KEY!;
  const found = await call(f, key, 'GET', `${NEON}/projects?search=${NEON_PROJECT}&limit=100`);
  let project = found.projects.find((p: { name: string }) => p.name === NEON_PROJECT);
  if (project) log(`neon ${NEON_PROJECT} ${project.id}: exists`);
  else {
    const created = await call(f, key, 'POST', `${NEON}/projects`, {
      project: { name: NEON_PROJECT, region_id: 'aws-eu-central-1', pg_version: 17 },
    });
    project = created.project;
    log(`neon ${NEON_PROJECT} ${project.id}: created`);
  }
  return project.id as string;
}

export async function neonDatabaseUrl(
  env: Env,
  f: Fetch = fetch,
  log: (s: string) => void = console.log,
) {
  const id = await neonProject(env, f, log);
  const q = `database_name=${DB}&role_name=${ROLE}&pooled=true`;
  return (await call(f, env.NEON_API_KEY!, 'GET', `${NEON}/projects/${id}/connection_uri?${q}`))
    .uri as string;
}

async function vercelProject(
  f: Fetch,
  token: string,
  name: string,
  dir: string,
  log: (s: string) => void,
) {
  const p = `${VERCEL}/v9/projects/${name}`;
  if (await call(f, token, 'GET', p)) return log(`vercel ${name}: exists`);
  await call(f, token, 'POST', `${VERCEL}/v11/projects`, {
    name,
    framework: null,
    rootDirectory: `apps/${dir}`,
  });
  // nodeVersion is not accepted on create.
  await call(f, token, 'PATCH', p, { nodeVersion: '26.x' });
  log(`vercel ${name}: created`);
}

async function checkDomain(f: Fetch, token: string, name: string) {
  const r = await call(f, token, 'GET', `${VERCEL}/v9/projects/${name}/domains?production=true`);
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
  f: Fetch,
  token: string,
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
    const r = await call(f, token, 'POST', base, {
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
  await call(f, token, 'PATCH', `${VERCEL}/v9/projects/${project}/env/${cur.id}`, {
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

  const dbUrl = await neonDatabaseUrl(env, f, log);
  for (const [dir, name] of Object.entries(names)) {
    await vercelProject(f, token, name, dir, log);
    await checkDomain(f, token, name);
  }

  const api = names.api!;
  const list = await call(f, token, 'GET', `${VERCEL}/v10/projects/${api}/env`);
  const existing = list.envs ?? list;
  const random = () => randomBytes(32).toString('base64url');
  await setEnv(f, token, api, existing, 'DATABASE_URL', () => dbUrl, true, log);
  await setEnv(f, token, api, existing, 'JWT_SECRET', random, false, log);
  await setEnv(f, token, api, existing, 'CRON_SECRET', random, false, log);
}

if (import.meta.main) {
  try {
    if (process.argv[2] === 'db-url') {
      const uri = await neonDatabaseUrl(process.env, fetch, () => {});
      console.log(`::add-mask::${uri}`);
      appendFileSync(process.env.GITHUB_ENV!, `DATABASE_URL=${uri}\n`);
    } else await provision(process.env);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

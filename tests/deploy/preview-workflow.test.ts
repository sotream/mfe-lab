// Q-workflow (static): .github/workflows/preview.yml. Text/regex checks, like workflows.test.ts
// (no YAML parser is resolvable from the repo root and no dependency may be added).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const raw = readFileSync(resolve(root, '.github/workflows/preview.yml'), 'utf8');
const t = raw
  .split('\n')
  .map((l) => l.replace(/(^|\s)#.*$/, ''))
  .join('\n');
const onBlock = /^on:\s*\n((?:[ \t]+.*\n|\s*\n)*)/m.exec(t + '\n')?.[1] ?? '';
// Body of a top-level job (until the next job at the same indent).
const job = (name: string) =>
  new RegExp(`^ {2}${name}:\\s*\\n([\\s\\S]*?)(?=^ {2}[\\w-]+:\\s*$|(?![\\s\\S]))`, 'm').exec(
    t + '\n',
  )?.[1] ?? '';
const jobNames = [
  ...(/^jobs:\s*\n((?:[ \t]+.*\n|\s*\n)*)/m.exec(t + '\n')?.[1] ?? '').matchAll(
    /^ {2}([\w-]+):\s*$/gm,
  ),
].map((m) => m[1]!);

describe('preview.yml', () => {
  it('Q-workflow: triggers on pull_request opened, synchronize, reopened, closed', () => {
    expect(onBlock).toMatch(/pull_request:/);
    for (const ty of ['opened', 'synchronize', 'reopened', 'closed'])
      expect(onBlock, ty).toContain(ty);
    expect(onBlock).not.toMatch(/\bpull_request_target\b|\bpush\b/);
  });

  it('Q-workflow: skips fork PRs and Dependabot', () => {
    expect(t).toMatch(
      /github\.event\.pull_request\.head\.repo\.full_name\s*==\s*github\.repository/,
    );
    expect(t).toMatch(/github\.actor\s*!=\s*'dependabot\[bot\]'/);
  });

  it('Q-workflow: never passes --prod', () => {
    expect(t).not.toMatch(/--prod\b/);
  });

  it('Q-workflow: permissions are exactly contents: read and pull-requests: write', () => {
    const m = /^permissions:\s*\n((?:[ \t]+.*\n)+)/m.exec(t + '\n');
    const lines = (m?.[1] ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .sort();
    expect(lines).toEqual(['contents: read', 'pull-requests: write']);
    expect(t).not.toMatch(/write-all/);
  });

  it('Q-workflow: every `uses:` is pinned to a 40-char SHA', () => {
    const uses = [...t.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u, u).toMatch(/^[\w./-]+@[0-9a-f]{40}$/);
  });

  it('Q-workflow: uses the same pinned Vercel CLI and only the existing secrets', () => {
    const deploy = readFileSync(resolve(root, '.github/workflows/deploy.yml'), 'utf8');
    const pin = /VERCEL_CLI:\s*(vercel@\d+\.\d+\.\d+)/.exec(deploy)?.[1];
    expect(pin).toBeTruthy();
    expect(t).toContain(`VERCEL_CLI: ${pin}`);
    const refs = [...t.matchAll(/\$\{\{\s*secrets\.(\w+)\s*\}\}/g)].map((m) => m[1]);
    expect(refs).toContain('VERCEL_TOKEN');
    expect(refs).toContain('NEON_API_KEY');
    for (const r of refs) expect(['VERCEL_TOKEN', 'NEON_API_KEY', 'GITHUB_TOKEN']).toContain(r);
  });

  it('Q-workflow: concurrency is per PR; deploys cancel, cleanup never does', () => {
    expect(t).toMatch(/preview-pr-\$\{\{\s*github\.event\.pull_request\.number\s*\}\}/);
    // Deploy side cancels in progress somewhere (workflow or deploy job).
    expect(t).toMatch(/cancel-in-progress:\s*(true|\$\{\{[^}]*\}\})/);
    const cleanup = jobNames.find((n) => /clean|remove|teardown/i.test(n));
    expect(cleanup, `a cleanup job among ${jobNames.join(', ')}`).toBeTruthy();
    const body = job(cleanup!);
    expect(body).not.toMatch(/cancel-in-progress:\s*true/);
    expect(body).toMatch(/closed/);
  });

  it('Q-workflow: cleanup deletes the Neon branch and the aliases; deploy job is not run on closed', () => {
    const body = job(jobNames.find((n) => /clean|remove|teardown/i.test(n)) ?? '__none__');
    expect(body).toMatch(/alias rm|alias remove/);
    expect(body).toMatch(/preview-db-delete/i);
    // The plan job gates every other one (T62 split the old single job).
    expect(job('plan')).toMatch(/action\s*!=\s*'closed'/);
  });

  it('Q-workflow: plan computes `needed` and the build job is gated on it', () => {
    expect(t).toMatch(/changed-apps\.ts --preview-needed/);
    expect(t).toMatch(/needed=\$needed/);
    expect(job('build')).toMatch(/if:\s*needs\.plan\.outputs\.needed == 'true'/);
    expect(job('comment')).toMatch(/export STATE=skipped/);
  });
});

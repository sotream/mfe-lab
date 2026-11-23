// Q-workflows: static checks on provision.yml and deploy.yml.
// No YAML parser is resolvable from the repo root (`yaml` exists only inside .pnpm, and no dependency may be added),
// so these are text/regex checks.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const read = (f: string) => readFileSync(resolve(root, '.github/workflows', f), 'utf8');
const files = { 'provision.yml': read('provision.yml'), 'deploy.yml': read('deploy.yml') };
const code = (t: string) =>
  t
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, ''))
    .join('\n');

// Top-level `on:` block: lines indented under `on:` until the next top-level key.
const onBlock = (t: string) => /^on:\s*\n((?:[ \t]+.*\n|\s*\n)*)/m.exec(code(t) + '\n')?.[1] ?? '';

describe('workflows', () => {
  it('Q-workflows: provision.yml is workflow_dispatch only', () => {
    const on = onBlock(files['provision.yml']);
    expect(on).toMatch(/workflow_dispatch/);
    expect(on).not.toMatch(/\b(push|pull_request\w*|schedule|workflow_run|release)\b\s*:/);
  });

  it('Q-workflows: deploy.yml triggers on workflow_run of CI (main, completed) and manual dispatch', () => {
    const t = code(files['deploy.yml']);
    const on = onBlock(t);
    expect(on).toMatch(/workflow_run:/);
    expect(on).toMatch(/workflows:\s*\[?\s*["']?CI["']?/);
    expect(on).toMatch(/types:\s*\[?\s*-?\s*completed/);
    expect(on).toMatch(/branches:\s*\[?\s*-?\s*["']?main["']?/);
    expect(on).toMatch(/workflow_dispatch:/);
    expect(on).toMatch(/apps:/);
    expect(on).not.toMatch(/\b(push|pull_request\w*)\s*:/);
    // Only successful CI runs deploy.
    expect(t).toMatch(/workflow_run\.conclusion\s*==\s*'success'/);
  });

  it('Q-workflows: the CI workflow name matches what deploy.yml listens for', () => {
    const name = /^name:\s*["']?(.+?)["']?\s*$/m.exec(read('ci.yml'))?.[1];
    expect(name).toBe('CI');
  });

  it('Q-workflows: deploy.yml has concurrency "deploy" without cancel-in-progress', () => {
    const t = code(files['deploy.yml']);
    expect(t).toMatch(/^concurrency:\s*(["']?deploy["']?\s*$|[\s\S]*?group:\s*["']?deploy["']?)/m);
    expect(t).not.toMatch(/cancel-in-progress:\s*true/);
  });

  it.each(Object.keys(files))('Q-workflows: %s has least-privilege permissions', (f) => {
    const t = code(files[f as keyof typeof files]);
    expect(t).toMatch(/^permissions:/m);
    const m = /^permissions:\s*\n((?:[ \t]+.*\n)+)/m.exec(t + '\n');
    const lines = (m?.[1] ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    expect(lines).toContain('contents: read');
    expect(t).not.toMatch(/write-all|:\s*write\b/);
  });

  it.each(Object.keys(files))(
    'Q-workflows: every `uses:` in %s is pinned to a 40-char SHA',
    (f) => {
      const uses = [
        ...code(files[f as keyof typeof files]).matchAll(/^\s*-?\s*uses:\s*(\S+)/gm),
      ].map((m) => m[1]!);
      expect(uses.length).toBeGreaterThan(0);
      for (const u of uses) expect(u, u).toMatch(/^[\w./-]+@[0-9a-f]{40}$/);
    },
  );

  it('Q-workflows: the Vercel CLI is pinned to an exact version', () => {
    const t = code(files['deploy.yml']);
    const refs = [...t.matchAll(/vercel@(\S+)/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(r, r).toMatch(/^\d+\.\d+\.\d+$/);
    expect(t).not.toMatch(/vercel@(latest|\^|~|\d+(\.\d+)?\s)/);
  });

  it('Q-workflows: deploy.yml runs pull, build and deploy per app, resolving projects by name', () => {
    const t = code(files['deploy.yml']);
    // The CLI is invoked through a pinned variable: `pnpm dlx "$VERCEL_CLI" <cmd>`.
    expect(t).toMatch(/VERCEL_CLI:\s*vercel@\d+\.\d+\.\d+/);
    expect(t).toMatch(/"\$VERCEL_CLI" link --yes --project/);
    expect(t).toMatch(/"\$VERCEL_CLI" pull --yes --environment=production/);
    expect(t).toMatch(/"\$VERCEL_CLI" build --prod/);
    expect(t).toMatch(/"\$VERCEL_CLI" deploy --prebuilt --prod/);
  });

  it('Q-workflows: secrets are only VERCEL_TOKEN and NEON_API_KEY, via ${{ secrets.X }}', () => {
    for (const [f, text] of Object.entries(files)) {
      const t = code(text);
      const refs = [...t.matchAll(/\$\{\{\s*secrets\.([\w]+)\s*\}\}/g)].map((m) => m[1]);
      for (const r of refs) expect(['VERCEL_TOKEN', 'NEON_API_KEY'], `${f} ${r}`).toContain(r);
      // No other form of secrets access.
      expect(t.replace(/\$\{\{\s*secrets\.\w+\s*\}\}/g, '')).not.toMatch(/secrets(\.|\[)/);
      expect(t).not.toMatch(/secrets:\s*inherit/);
    }
    expect(code(files['provision.yml'])).toMatch(/secrets\.VERCEL_TOKEN/);
    expect(code(files['provision.yml'])).toMatch(/secrets\.NEON_API_KEY/);
    expect(code(files['deploy.yml'])).toMatch(/secrets\.VERCEL_TOKEN/);
  });

  it('Q-workflows: provision.yml runs the script, migrate and seed, and masks the DB URL', () => {
    const t = code(files['provision.yml']);
    expect(t).toMatch(/scripts\/provision\.ts/);
    expect(t).toMatch(/@mfe\/api migrate/);
    expect(t).toMatch(/@mfe\/api seed/);
    // Masking lives in the `db-url` subcommand, which exports DATABASE_URL for the next steps.
    expect(t).toMatch(/scripts\/provision\.ts db-url/);
    expect(readFileSync(resolve(root, 'scripts/provision.ts'), 'utf8')).toMatch(/::add-mask::/);
  });

  it('Q-workflows: deploy.yml migrates the api, orders api -> remotes -> shell, and smoke-checks', () => {
    const t = code(files['deploy.yml']);
    expect(t).toMatch(/@mfe\/api migrate/);
    expect(t).toMatch(/mfe-lab\.vercel\.app/);
    expect(t).toMatch(/mf-manifest\.json/);
    expect(t).toMatch(/cron\/reseed/);
    // shell depends (transitively) on the remotes, which depend on api.
    const needs = (job: string) => {
      const m = new RegExp(`^  ${job}:[\\s\\S]*?^    needs:\\s*(.+)$`, 'm').exec(t);
      return m?.[1] ?? '';
    };
    // The remotes (products, dashboard, orders) are one matrix build and one matrix ship (T62).
    expect(needs('shell-build')).toMatch(/remotes-ship/);
    expect(needs('remotes-build')).toMatch(/api-ship/);
    expect(needs('api-ship')).toMatch(/api-build/);
    expect(t).toMatch(/remotes=/);
  });

  it('Q-workflows: every vercel link/pull/deploy line in deploy.yml carries the scope array', () => {
    const t = code(files['deploy.yml']);
    const lines = t
      .split('\n')
      .filter((l) =>
        /\$VERCEL_CLI"?\s+(link|pull|deploy)\b|\bvercel(@\S+)?\s+(link|pull|deploy)\b/.test(l),
      );
    // api + matrix remotes + shell, three commands each; `vercel build` runs without the token (T62)
    expect(lines.length).toBeGreaterThanOrEqual(9);
    for (const l of lines) expect(l, l).toMatch(/"\$\{scope\[@\]\}"/);
  });

  it('Q-workflows: the scope array is built from the vercel-scope subcommand, empty when personal', () => {
    const t = code(files['deploy.yml']);
    expect(t).toMatch(/provision\.ts vercel-scope/);
    expect(t).toMatch(/--scope "\$slug"/);
    expect(t).toMatch(/\[ -z "\$slug" \] \|\|/);
  });
});

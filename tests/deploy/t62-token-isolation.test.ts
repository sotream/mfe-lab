// T62: static checks on deploy.yml and preview.yml. The deploy token reaches only the pull and deploy
// steps; nothing that runs third-party code (install, build) sees it. Text-based, like workflows.test.ts.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const names = ['deploy.yml', 'preview.yml'] as const;
const read = (f: string) =>
  readFileSync(resolve(root, '.github/workflows', f), 'utf8')
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, ''))
    .join('\n');

type Step = { text: string };
type Job = { name: string; text: string; env: string; steps: Step[] };

// jobs: two-space job keys, four-space job fields, six-space "- " steps.
const jobsOf = (t: string): Job[] => {
  const after = t.split(/^jobs:\s*$/m)[1] ?? '';
  const parts = after.split(/^ {2}(?=[\w-]+:\s*$)/m).slice(1);
  return parts.map((p) => {
    const name = /^([\w-]+):/.exec(p)![1]!;
    const [head = '', ...rest] = p.split(/^ {4}steps:\s*$/m);
    const stepsText = rest.join('\n');
    const env = /^ {4}env:\s*\n((?: {6,}.*\n?)*)/m.exec(head)?.[1] ?? '';
    const steps = stepsText
      .split(/^ {6}- /m)
      .slice(1)
      .map((s) => ({ text: s }));
    return { name, text: p, env, steps };
  });
};

const hasToken = (s: Step) => /VERCEL_TOKEN\s*:/.test(s.text);
const FORBIDDEN =
  /pnpm\s+install|pnpm\s+i\b|pnpm\s+--filter|pnpm\s+(run\s+)?build|pnpm\s+exec|\bvercel(@\S+)?\s+build|\$VERCEL_CLI"?\s+build|\bvc\s+build/;

describe.each(names)('T62 token isolation in %s', (file) => {
  const t = read(file);
  const jobs = jobsOf(t);

  it('Q-t62-workflows: the file has jobs and steps (parser sanity)', () => {
    expect(jobs.length).toBeGreaterThan(1);
    expect(jobs.flatMap((j) => j.steps).length).toBeGreaterThan(5);
  });

  it('Q-t62-workflows: no workflow-level or job-level VERCEL_TOKEN', () => {
    const top = t.split(/^jobs:\s*$/m)[0]!;
    expect(top).not.toMatch(/VERCEL_TOKEN/);
    for (const j of jobs) expect(j.env, j.name).not.toMatch(/VERCEL_TOKEN/);
  });

  it('Q-t62-workflows: no step with the token runs install, a build or a repo-script package command', () => {
    for (const j of jobs)
      for (const s of j.steps.filter(hasToken))
        expect(s.text, `${j.name}: ${s.text.slice(0, 80)}`).not.toMatch(FORBIDDEN);
  });

  it('Q-t62-workflows: every vercel deploy step has the token', () => {
    const deploys = jobs
      .flatMap((j) => j.steps)
      .filter((s) => /\bdeploy\b[^\n]*--prebuilt/.test(s.text));
    expect(deploys.length).toBeGreaterThan(0);
    for (const s of deploys) expect(hasToken(s), s.text.slice(0, 80)).toBe(true);
  });

  it('Q-t62-workflows: a job that deploys runs no pnpm install, and the build runs elsewhere', () => {
    const shipJobs = jobs.filter((j) =>
      j.steps.some((s) => /\bdeploy\b[^\n]*--prebuilt/.test(s.text)),
    );
    expect(shipJobs.length).toBeGreaterThan(0);
    for (const j of shipJobs) {
      expect(j.text, j.name).not.toMatch(/pnpm\s+install|pnpm\s+i\b/);
      expect(j.text, j.name).not.toMatch(FORBIDDEN);
    }
  });

  it('Q-t62-workflows: in a job that pulls, the pull runs before pnpm install', () => {
    const pullJobs = jobs.filter((j) =>
      j.steps.some((s) => /\bpull\b/.test(s.text) && hasToken(s)),
    );
    expect(pullJobs.length).toBeGreaterThan(0);
    for (const j of pullJobs) {
      const pull = j.steps.findIndex((s) => /\bpull\b/.test(s.text) && hasToken(s));
      const install = j.steps.findIndex((s) => /pnpm\s+install/.test(s.text));
      if (install !== -1) expect(pull, j.name).toBeLessThan(install);
    }
  });

  it('Q-t62-workflows: the build output is handed over as an artifact, without .vercel env files', () => {
    expect(t).toMatch(/actions\/upload-artifact@/);
    expect(t).toMatch(/actions\/download-artifact@/);
    expect(t).toMatch(/\.vercel\/output/);
    expect(t).toMatch(/\.vercel\/project\.json/);
    for (const j of jobs)
      for (const s of j.steps.filter((x) => /upload-artifact@/.test(x.text))) {
        expect(s.text, j.name).not.toMatch(
          /\.vercel\/\.env|\.vercel\/\*\*|path:\s*\.vercel\/?\s*$/m,
        );
        expect(s.text, j.name).toMatch(/retention-days:\s*[123]\b/);
      }
  });

  it('Q-t62-workflows: every action is pinned by a full SHA', () => {
    const uses = [...t.matchAll(/^\s*(?:- )?uses:\s*(\S+)/gm)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u, u).toMatch(/@[0-9a-f]{40}$/);
  });
});

describe('T62 deploy ordering is kept', () => {
  it('Q-t62-workflows: deploy.yml still has api, remotes, shell, smoke and vitals in order', () => {
    const names = jobsOf(read('deploy.yml')).map((j) => j.name);
    const at = (n: string) => names.findIndex((x) => x.startsWith(n));
    for (const n of ['api', 'remotes', 'shell', 'smoke', 'vitals'])
      expect(at(n), n).toBeGreaterThan(-1);
    expect(at('api')).toBeLessThan(at('remotes'));
    expect(at('remotes')).toBeLessThan(at('shell'));
    expect(at('shell')).toBeLessThan(at('smoke'));
  });
});

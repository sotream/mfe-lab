// Q-ci-concurrency + Q-deploy-base (T48 H4/H5/M4): black-box from the T48 contract.
// ASSUMED scripts/deploy-base.ts (new, pure):
//   deployBase({ event: 'workflow_run' | 'workflow_dispatch' | 'schedule', ref: string, lastDeployed?: string | null })
//     -> string  the SHA to diff from (the last successful production deploy)
//     -> null    nothing known: deploy all
//     throws (message mentions "main") for workflow_dispatch from a ref other than refs/heads/main.
// deploy.yml is checked as text: no HEAD~1 diff base, weekly schedule, main-only dispatch.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deployBase, lastDeployedSha } from '../../scripts/deploy-base.ts';

const root = resolve(import.meta.dirname, '../..');
const strip = (t: string) =>
  t
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, ''))
    .join('\n');
const read = (f: string) => strip(readFileSync(resolve(root, '.github/workflows', f), 'utf8'));
const LAST = 'a'.repeat(40);
const MAIN = 'refs/heads/main';

describe('ci.yml concurrency', () => {
  it('Q-ci-concurrency: cancel-in-progress is true only for pull_request runs', () => {
    const t = read('ci.yml');
    const block = /^concurrency:\s*\n((?:[ \t]+.*\n)+)/m.exec(t + '\n')?.[1] ?? '';
    const v = /cancel-in-progress:\s*(.+)$/m.exec(block)?.[1]?.trim() ?? '';
    expect(v).not.toBe('true');
    expect(v).toMatch(/github\.event_name\s*==\s*'pull_request'/);
    expect(v).not.toMatch(/!=|\|\||push/);
  });
});

describe('deployBase', () => {
  it('Q-deploy-base: diffs from the last deployed SHA when there is one', () => {
    for (const event of ['workflow_run', 'workflow_dispatch', 'schedule'] as const)
      expect(deployBase({ event, ref: MAIN, lastDeployed: LAST })).toBe(LAST);
  });

  it('Q-deploy-base: no last deployed SHA means deploy all', () => {
    expect(deployBase({ event: 'workflow_run', ref: MAIN })).toBeNull();
    expect(deployBase({ event: 'workflow_run', ref: MAIN, lastDeployed: null })).toBeNull();
    expect(deployBase({ event: 'schedule', ref: MAIN, lastDeployed: '' })).toBeNull();
  });

  it('Q-deploy-base: dispatch from a non-main ref fails with a clear message', () => {
    for (const ref of [
      'refs/heads/feature/x',
      'refs/heads/main-old',
      'refs/tags/v1',
      'refs/pull/1/merge',
    ])
      expect(
        () => deployBase({ event: 'workflow_dispatch', ref, lastDeployed: LAST }),
        ref,
      ).toThrow(/main/);
  });

  it('Q-deploy-base: dispatch from main is allowed', () => {
    expect(() =>
      deployBase({ event: 'workflow_dispatch', ref: MAIN, lastDeployed: LAST }),
    ).not.toThrow();
  });
});

describe('lastDeployedSha', () => {
  it('Q-deploy-base: picks the first successful run', () => {
    const runs = [
      { conclusion: 'failure', head_sha: 'f'.repeat(40) },
      { conclusion: 'success', head_sha: LAST },
      { conclusion: 'success', head_sha: 'b'.repeat(40) },
    ];
    expect(lastDeployedSha(runs as never)).toBe(LAST);
    expect(lastDeployedSha([] as never) || null).toBeNull();
  });
});

describe('deploy.yml', () => {
  const t = read('deploy.yml');
  const onBlock = /^on:\s*\n((?:[ \t]+.*\n|\s*\n)*)/m.exec(t + '\n')?.[1] ?? '';

  it('Q-deploy-base: the plan no longer diffs against HEAD~1', () => {
    expect(t).not.toMatch(/HEAD~1/);
  });

  it('Q-deploy-base: the base is the last successful prod deploy (gh api on deploy.yml runs, or a deployed/prod tag)', () => {
    // the runs API is named in a comment, so check the raw text
    const raw = readFileSync(resolve(root, '.github/workflows/deploy.yml'), 'utf8');
    expect(raw).toMatch(/actions\/workflows\/deploy\.yml\/runs/);
  });

  it('Q-deploy-catchup: a weekly schedule catches up dependency-only merges', () => {
    expect(onBlock).toMatch(/schedule:/);
    const cron = /cron:\s*["']([^"']+)["']/.exec(onBlock)?.[1]?.split(/\s+/) ?? [];
    expect(cron).toHaveLength(5);
    // weekly: a concrete day of week, a concrete day-of-month wildcard
    expect(cron[2]).toBe('*');
    expect(cron[4]).toMatch(/^([0-6]|mon|tue|wed|thu|fri|sat|sun)$/i);
  });

  it('Q-deploy-dispatch: the plan job refuses to deploy unless the ref is refs/heads/main', () => {
    expect(t).toMatch(/refs\/heads\/main/);
    expect(t).toMatch(/exit 1|::error/);
  });
});

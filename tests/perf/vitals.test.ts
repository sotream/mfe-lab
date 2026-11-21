// Q-vitals-script + Q-ci-budget.
// Importing scripts/vitals.ts must not run it.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compare, median, metricNames, p90, summary } from '../../scripts/vitals.ts';

const root = resolve(import.meta.dirname, '../..');
const read = (f: string) => readFileSync(resolve(root, f), 'utf8');
const code = (t: string) => t.replace(/(^|\s)#.*$/gm, '');

describe('vitals helpers', () => {
  it('Q-vitals-script: median of odd and even counts, unsorted input untouched', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });

  it('Q-vitals-script: p90 of 1..10 is 9 and of a single value is itself', () => {
    expect(p90([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])).toBe(9);
    expect(p90([5])).toBe(5);
  });

  it('Q-vitals-script: compare reports median and p90 per metric and flags only the median over budget', () => {
    const budgets = { lcpMs: 2500, clsLogin: 0.1, timeToRemotesMs: 700, clsHome: 0.1 };
    const run = (lcpMs: number) => ({ lcpMs, clsLogin: 0.05, timeToRemotesMs: 700, clsHome: 0.1 });
    const ok = compare([run(2400), run(2500), run(2500)], budgets);
    expect(ok.map((r) => r.metric).sort()).toEqual([...metricNames].sort());
    expect(ok.every((r) => !r.over)).toBe(true);
    const over = compare([run(2600), run(2700), run(2800)], budgets);
    expect(over.filter((r) => r.over).map((r) => r.metric)).toEqual(['lcpMs']);
    const lcp = over.find((r) => r.metric === 'lcpMs')!;
    expect(lcp).toMatchObject({ median: 2700, p90: 2800, budget: 2500 });
  });

  it('Q-vitals-script: summary lists every metric with its budget', () => {
    const budgets = { lcpMs: 2500, clsLogin: 0.1, timeToRemotesMs: 700, clsHome: 0.1 };
    const text = summary(
      compare([{ lcpMs: 3000, clsLogin: 0, timeToRemotesMs: 1, clsHome: 0 }], budgets),
    );
    for (const m of metricNames) expect(text).toContain(m);
    expect(text).toMatch(/OVER/);
  });
});

describe('workflows (perf)', () => {
  // Job block: from `  <name>:` to the next 2-space-indented key.
  const job = (t: string, name: string) =>
    new RegExp(`^  ${name}:\\n((?:(?:   .*)?\\n)*)`, 'm').exec(code(t) + '\n')?.[1] ?? '';

  it('Q-vitals-script: deploy.yml vitals job runs after smoke, pinned actions, contents: read', () => {
    const v = job(read('.github/workflows/deploy.yml'), 'vitals');
    expect(v, 'vitals job exists').not.toBe('');
    expect(v).toMatch(/needs:\s*(\[[^\]]*\bsmoke\b[^\]]*\]|smoke\b|\n\s*-\s*smoke\b)/);
    expect(v).toMatch(/scripts\/vitals\.ts/);
    // Job-level permissions, or the top-level `contents: read` it inherits.
    const wf = code(read('.github/workflows/deploy.yml'));
    expect(v + wf).toMatch(/^\s*permissions:\s*\n\s+contents:\s*read\s*$/m);
    expect(v).not.toMatch(/contents:\s*write/);
    const uses = [...v.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!);
    for (const u of uses) expect(u, u).toMatch(/@[0-9a-f]{40}$/);
  });

  it('Q-ci-budget: ci.yml runs size-budget after pnpm build', () => {
    const ci = code(read('.github/workflows/ci.yml'));
    const build = ci.search(/run:\s*pnpm build\b/);
    const budget = ci.search(/run:\s*node scripts\/size-budget\.ts/);
    expect(build).toBeGreaterThan(-1);
    expect(budget).toBeGreaterThan(build);
  });
});

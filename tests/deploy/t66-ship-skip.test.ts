// T66: a job whose needs include a conditionally skipped job is itself skipped by the implicit
// success(). Static, text-based check on deploy.yml.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const text = readFileSync(
  resolve(import.meta.dirname, '../../.github/workflows/deploy.yml'),
  'utf8',
)
  .split('\n')
  .map((l) => l.replace(/(^|\s)#.*$/, ''))
  .join('\n');

const jobs = (text.split(/^jobs:\s*$/m)[1] ?? '')
  .split(/^ {2}(?=[\w-]+:\s*$)/m)
  .slice(1)
  .map((p) => ({
    name: /^([\w-]+):/.exec(p)![1]!,
    needs: (/^ {4}needs:\s*\[?([^\]\n]*)\]?/m.exec(p)?.[1] ?? '')
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean),
    cond: /^ {4}if:\s*(.*)$/m.exec(p)?.[1],
  }));

describe('deploy.yml skipped needs', () => {
  // plan is excluded: if it is skipped, nothing should run.
  it('jobs needing a conditional job use !cancelled()', () => {
    const conditional = new Set(
      jobs.filter((j) => j.cond !== undefined && j.name !== 'plan').map((j) => j.name),
    );
    for (const j of jobs.filter((j) => j.needs.some((n) => conditional.has(n)))) {
      expect(j.cond, j.name).toContain('!cancelled()');
    }
  });

  it('each ship job checks its build job result', () => {
    const ships = jobs.filter((j) => j.name.endsWith('-ship'));
    expect(ships.map((j) => j.name)).toEqual(['api-ship', 'remotes-ship', 'shell-ship']);
    for (const j of ships) {
      const build = j.name.replace('-ship', '-build');
      expect(j.cond, j.name).toContain(`needs.${build}.result == 'success'`);
    }
  });
});

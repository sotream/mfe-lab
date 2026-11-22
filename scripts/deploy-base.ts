// The diff base of a production deploy: the head SHA of the last successful deploy.yml run on main.
//   node scripts/deploy-base.ts   env: EVENT_NAME REF GITHUB_REPOSITORY GH_TOKEN
// Prints the SHA, or nothing when there is none (the caller then deploys everything).
// A manual run from another ref throws.
import { execFileSync } from 'node:child_process';

export type Run = { head_sha: string; conclusion: string | null };

// Runs come newest first. The first success is the base; a failed or cancelled run deployed nothing we can trust.
export const lastDeployedSha = (runs: readonly Run[]): string | undefined =>
  runs.find((r) => r.conclusion === 'success')?.head_sha;

// The SHA to diff from, or null (deploy everything). A manual run off main throws.
export function deployBase(i: { event: string; ref: string; lastDeployed?: string | null }) {
  if (i.event === 'workflow_dispatch' && i.ref !== 'refs/heads/main')
    throw new Error(`deploy only runs from main, not ${i.ref}`);
  return i.lastDeployed || null;
}

if (import.meta.main) {
  try {
    const e = process.env;
    deployBase({ event: e.EVENT_NAME ?? '', ref: e.REF ?? '' }); // fail early off main
    const out = execFileSync(
      'gh',
      [
        'api',
        `repos/${e.GITHUB_REPOSITORY}/actions/workflows/deploy.yml/runs?branch=main&status=success&per_page=1`,
        '--jq',
        '.workflow_runs',
      ],
      { encoding: 'utf8' },
    );
    console.log(
      deployBase({
        event: e.EVENT_NAME ?? '',
        ref: e.REF ?? '',
        lastDeployed: lastDeployedSha(JSON.parse(out)),
      }) ?? '',
    );
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

// Allowlist for Dependabot auto-merge. Prints merge=true|false for GITHUB_OUTPUT.
//   node scripts/dependabot-merge.ts   env: UPDATES (fetch-metadata updated-dependencies-json) ECOSYSTEM GITHUB_REPOSITORY PR GH_TOKEN
import { execFileSync } from 'node:child_process';

export type Update = { updateType?: string; newVersion?: string };

// Patch always; minor only when the new version is >= 1.0.0 (0.x minors may break). Everything else is manual.
const okUpdate = ({ updateType, newVersion }: Update) =>
  updateType === 'version-update:semver-patch' ||
  (updateType === 'version-update:semver-minor' && Number.parseInt(newVersion ?? '', 10) >= 1);

export const shouldAutoMerge = (
  i: Update & { ecosystem?: string; commitAuthors: readonly string[] },
) =>
  okUpdate(i) &&
  i.ecosystem !== 'github_actions' &&
  i.commitAuthors.length > 0 &&
  i.commitAuthors.every((a) => a === 'dependabot[bot]');

if (import.meta.main) {
  const e = process.env;
  const commitAuthors = execFileSync(
    'gh',
    [
      'api',
      `repos/${e.GITHUB_REPOSITORY}/pulls/${e.PR}/commits`,
      '--paginate',
      '--jq',
      '.[].author.login',
    ],
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean);
  let updates: Update[] = [];
  try {
    updates = JSON.parse(e.UPDATES || '[]');
  } catch {
    // unparsable: no updates, so no merge
  }
  const merge =
    updates.length > 0 &&
    updates.every((u) => shouldAutoMerge({ ...u, ecosystem: e.ECOSYSTEM, commitAuthors }));
  console.log(`merge=${merge}`);
}

// The sticky PR comment of a preview.
//   node scripts/preview-comment.ts body|post   env: PR SHA STATE (open|closed|skipped) CHANGED SMOKE UNAVAILABLE
// `post` creates the comment or edits the one with the marker (gh, GH_TOKEN, GITHUB_REPOSITORY).
import { execFileSync } from 'node:child_process';
import { previewUrls } from './preview-urls.ts';
import { previewBranchName } from './provision.ts';

export const MARKER = '<!-- mfe-lab-preview -->';
const ORDER = ['shell', 'products', 'dashboard', 'orders', 'api'] as const;
export const DEMO_LOGIN = 'admin@lab.test / lab12345';

// The comment to edit: carries the marker and was written by the Actions bot (anyone else could plant the marker).
export const findMarkerComment = (
  comments: readonly { id: number; user?: { login?: string } | null; body?: string | null }[],
) => comments.find((c) => c.user?.login === 'github-actions[bot]' && c.body?.includes(MARKER))?.id;

export type CommentInput = {
  pr: number | string;
  sha: string;
  neonBranch?: string; // default preview/pr-<pr>
  changed?: readonly string[];
  smoke?: 'passed' | 'failed';
  state?: 'open' | 'closed' | 'skipped';
  unavailable?: string; // reason; the preview could not be built
};

export function previewComment(i: CommentInput): string {
  const sha = i.sha.slice(0, 7);
  const branch = i.neonBranch ?? previewBranchName(i.pr);
  if (i.state === 'skipped')
    return `${MARKER}\n### Preview skipped\n\nThis PR changes no app (only docs, tests or CI), so nothing was deployed. (commit \`${sha}\`)\n`;
  if (i.state === 'closed')
    return `${MARKER}\n### Preview removed\n\nThe preview stack and the Neon branch \`${branch}\` of this PR were deleted (last commit \`${sha}\`).\n`;
  if (i.unavailable !== undefined)
    return `${MARKER}\n### Preview unavailable\n\npreview unavailable: ${i.unavailable} (commit \`${sha}\`)\n`;
  const urls = previewUrls(i.pr, i.changed ?? []);
  return [
    MARKER,
    `### Preview: ${urls.shell.url}`,
    '',
    '| app | url | build |',
    '| --- | --- | --- |',
    ...ORDER.map((a) => `| ${a} | ${urls[a].url} | ${urls[a].kind} |`),
    '',
    `- Neon branch: \`${branch}\``,
    `- Demo login (demo-only): \`${DEMO_LOGIN}\``,
    `- Commit: \`${sha}\``,
    `- Smoke: ${i.smoke === 'passed' ? 'passed' : 'FAILED'}`,
    '',
  ].join('\n');
}

if (import.meta.main) {
  const e = process.env;
  const body = previewComment({
    pr: e.PR!,
    sha: e.SHA!,
    state: e.STATE === 'closed' || e.STATE === 'skipped' ? e.STATE : 'open',
    changed: (e.CHANGED ?? '').split(' ').filter(Boolean),
    smoke: e.SMOKE === 'passed' ? 'passed' : 'failed',
    unavailable: e.UNAVAILABLE || undefined,
  });
  if (process.argv[2] === 'body') process.stdout.write(body);
  else {
    const api = `repos/${e.GITHUB_REPOSITORY}/issues`;
    const gh = (...a: string[]) => execFileSync('gh', ['api', ...a], { encoding: 'utf8' });
    const id = findMarkerComment(
      gh(`${api}/${e.PR}/comments`, '--paginate', '--jq', '.[]')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l)),
    );
    if (id) gh('-X', 'PATCH', `${api}/comments/${id}`, '-f', `body=${body}`);
    else gh('-X', 'POST', `${api}/${e.PR}/comments`, '-f', `body=${body}`);
  }
}

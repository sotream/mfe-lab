// Q-comment-author + Q-dependabot-allowlist (T48 lows): black-box from the T48 contract.
// ASSUMED scripts/preview-comment.ts export:
//   findMarkerComment(comments: { id: number; body: string; user: { login: string } }[]) -> number | undefined
//   the id of the first comment that has MARKER in its body AND is authored by 'github-actions[bot]'.
//   `post` creates a new comment when it returns undefined (so another user's marker comment is never edited).
// ASSUMED scripts/dependabot-merge.ts (new, pure):
//   shouldAutoMerge({ updateType: string, newVersion: string, ecosystem?: string, commitAuthors: string[] }) -> boolean
//   updateType is the dependabot/fetch-metadata output, e.g. 'version-update:semver-patch'.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { shouldAutoMerge } from '../../scripts/dependabot-merge.ts';
import { MARKER, findMarkerComment } from '../../scripts/preview-comment.ts';

const root = resolve(import.meta.dirname, '../..');
const BOT = 'github-actions[bot]';
const c = (id: number, login: string, body = `${MARKER}\nhi`) => ({ id, body, user: { login } });

describe('preview comment author', () => {
  it('Q-comment-author: picks the marker comment of github-actions[bot]', () => {
    expect(findMarkerComment([c(1, 'someone', 'hello'), c(2, BOT)])).toBe(2);
  });

  it('Q-comment-author: a marker comment by another user is ignored (a new one gets created)', () => {
    expect(findMarkerComment([c(1, 'mallory')])).toBeUndefined();
    expect(findMarkerComment([c(1, 'mallory'), c(2, 'github-actions')])).toBeUndefined();
    expect(findMarkerComment([c(1, 'mallory'), c(2, BOT)])).toBe(2);
  });

  it('Q-comment-author: a bot comment without the marker is ignored', () => {
    expect(findMarkerComment([c(1, BOT, 'unrelated')])).toBeUndefined();
    expect(findMarkerComment([])).toBeUndefined();
  });

  it('Q-comment-author: the post path no longer selects by marker alone', () => {
    const src = readFileSync(resolve(root, 'scripts/preview-comment.ts'), 'utf8');
    expect(src).toContain('github-actions[bot]');
  });
});

const D = 'dependabot[bot]';
const ok = { commitAuthors: [D], ecosystem: 'npm_and_yarn' };

describe('dependabot allowlist', () => {
  it('Q-dependabot-allowlist: patch and minor of a >=1.0.0 package merge', () => {
    expect(
      shouldAutoMerge({ ...ok, updateType: 'version-update:semver-patch', newVersion: '1.2.4' }),
    ).toBe(true);
    expect(
      shouldAutoMerge({ ...ok, updateType: 'version-update:semver-minor', newVersion: '2.3.0' }),
    ).toBe(true);
    expect(
      shouldAutoMerge({ ...ok, updateType: 'version-update:semver-patch', newVersion: '0.4.2' }),
    ).toBe(true);
  });

  it('Q-dependabot-allowlist: major, unknown and empty update types do not merge', () => {
    for (const updateType of [
      'version-update:semver-major',
      'version-update:something-new',
      '',
      'garbage',
    ])
      expect(shouldAutoMerge({ ...ok, updateType, newVersion: '3.0.0' }), updateType).toBe(false);
  });

  it('Q-dependabot-allowlist: a 0.x minor does not merge', () => {
    expect(
      shouldAutoMerge({ ...ok, updateType: 'version-update:semver-minor', newVersion: '0.5.0' }),
    ).toBe(false);
    expect(
      shouldAutoMerge({ ...ok, updateType: 'version-update:semver-minor', newVersion: '0.12.1' }),
    ).toBe(false);
  });

  it('Q-dependabot-allowlist: any commit by someone else blocks the merge', () => {
    const base = { ...ok, updateType: 'version-update:semver-patch', newVersion: '1.0.1' };
    expect(shouldAutoMerge({ ...base, commitAuthors: [D, 'mallory'] })).toBe(false);
    expect(shouldAutoMerge({ ...base, commitAuthors: ['mallory'] })).toBe(false);
    expect(shouldAutoMerge({ ...base, commitAuthors: [] })).toBe(false);
  });

  it('Q-dependabot-allowlist: github_actions bumps still do not merge', () => {
    expect(
      shouldAutoMerge({
        ...ok,
        ecosystem: 'github_actions',
        updateType: 'version-update:semver-patch',
        newVersion: '1.0.1',
      }),
    ).toBe(false);
  });

  it('Q-dependabot-allowlist: the workflow delegates to the allowlist script, not a semver-major denylist', () => {
    const t = readFileSync(resolve(root, '.github/workflows/dependabot-auto-merge.yml'), 'utf8')
      .split('\n')
      .map((l) => l.replace(/(^|\s)#.*$/, ''))
      .join('\n');
    expect(t).not.toMatch(/update-type\s*!=\s*'version-update:semver-major'/);
    expect(t).toMatch(/dependabot-merge\.ts/);
  });
});

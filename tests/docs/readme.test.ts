// Q-readme: README, tour and architecture links resolve; the RFC table is complete; the README names what it does not do.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const readme = read('README.md');

// ponytail: GitHub slug approximation (lowercase, drop punctuation, spaces to hyphens); no duplicate-heading "-1" suffixes.
const slug = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');

const headings = (md: string) =>
  [...md.replace(/```[\s\S]*?```/g, '').matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)].map((m) => m[1] ?? '');

// ponytail: regex scan, not a markdown parser; covers ](...), src=, srcset=, href=. Add a parser if a link form slips through.
const targets = (md: string) => {
  const out: string[] = [];
  for (const m of md.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)/g)) out.push(m[1] ?? '');
  for (const m of md.matchAll(/\b(?:src|href)="([^"]+)"/g)) out.push(m[1] ?? '');
  for (const m of md.matchAll(/\bsrcset="([^"]+)"/g))
    for (const c of (m[1] ?? '').split(',')) out.push(c.trim().split(/\s+/)[0] ?? '');
  return out.filter(Boolean);
};

describe('docs links', () => {
  for (const file of ['README.md', 'docs/tour.md', 'docs/architecture.md']) {
    it(`Q-readme: every relative link in ${file} resolves`, () => {
      const md = read(file);
      const slugs = new Set(headings(md).map(slug));
      const bad: string[] = [];
      for (const t of targets(md)) {
        if (/^(https?:|mailto:|\/\/)/i.test(t)) continue;
        if (t.startsWith('#')) {
          if (!slugs.has(decodeURIComponent(t.slice(1)))) bad.push(t);
          continue;
        }
        const path = decodeURIComponent(t.split('#')[0]!.split('?')[0]!);
        if (!existsSync(resolve(root, dirname(file), path))) bad.push(t);
      }
      expect(bad).toEqual([]);
    });
  }
});

describe('README content', () => {
  it('Q-readme: the RFC table lists every RFC file except the template and the index', () => {
    const files = readdirSync(resolve(root, 'docs/rfc')).filter(
      (f) => f.endsWith('.md') && f !== '0000-template.md' && f !== 'README.md',
    );
    const missing = files.filter((f) => !readme.includes(`docs/rfc/${f}`));
    expect(missing).toEqual([]);
  });

  it('Q-readme: has a "Deliberately not done" heading that mentions SSR', () => {
    const lines = readme.split('\n');
    const i = lines.findIndex((l) => /^#{1,6}\s+.*deliberately not done/i.test(l));
    expect(i, 'heading "Deliberately not done" not found').toBeGreaterThanOrEqual(0);
    const rest = lines.slice(i + 1);
    const end = rest.findIndex((l) => /^#{1,6}\s/.test(l));
    const section = [lines[i], ...(end < 0 ? rest : rest.slice(0, end))].join('\n');
    expect(section).toMatch(/\bSSR\b|server-side rendering/i);
  });
});

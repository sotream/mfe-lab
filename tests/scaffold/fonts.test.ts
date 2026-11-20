import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ui = join(import.meta.dirname, '../../packages/ui/src');
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );

describe('self-hosted fonts', () => {
  it('Q-no-external-fonts: every url() in @mfe/ui CSS is relative; woff2 files and an OFL license ship', () => {
    const css = walk(ui).filter((f) => f.endsWith('.css'));
    expect(css.length).toBeGreaterThan(0);
    const urls = css.flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]),
    );
    for (const u of urls) expect(u, u).not.toMatch(/^(https?:)?\/\//);
    const fonts = readdirSync(join(ui, 'fonts'));
    expect(fonts.filter((f) => f.endsWith('.woff2')).length).toBeGreaterThanOrEqual(2);
    expect(fonts.some((f) => /^OFL/i.test(f))).toBe(true);
  });
});

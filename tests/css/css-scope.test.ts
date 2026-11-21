// Q-css-scope: every selector in a React remote's own CSS starts with the remote's prefix class or
// [data-remote="<name>"]. Shared @mfe/ui CSS is exempt (versioned, prefixed design system, RFC 0008).
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

type Block = { prelude: string; body: string };

/** Top-level `prelude { body }` pairs; braces nest. */
function blocks(src: string): Block[] {
  const out: Block[] = [];
  let depth = 0;
  let start = 0;
  let open = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '{' && depth++ === 0) open = i;
    else if (src[i] === '}' && --depth === 0) {
      out.push({ prelude: src.slice(start, open).trim(), body: src.slice(open + 1, i) });
      start = i + 1;
    }
  }
  return out;
}

/** Split on top-level commas only (:is(a, b)); a comma inside a quoted attribute value is not handled. */
function splitList(prelude: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of prelude) {
    depth += '(['.includes(ch) ? 1 : ')]'.includes(ch) ? -1 : 0;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  return [...parts, cur.trim()];
}

/** All style-rule selectors, recursing into @media/@container/@supports; keyframes and @font-face are skipped. */
export function selectors(css: string): string[] {
  return blocks(css.replace(/\/\*[\s\S]*?\*\//g, '')).flatMap(({ prelude, body }) => {
    if (!prelude.startsWith('@')) return splitList(prelude);
    return /^@(media|container|supports|layer)\b/.test(prelude) ? selectors(body) : [];
  });
}

const scoped = (sel: string, remote: string) =>
  new RegExp(`^(\\.${remote}(-[\\w-]+)?|\\[data-remote=["']?${remote}["']?\\])(?![\\w-])`).test(
    sel,
  );

const cssFiles = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.css'))
    .map((f) => join(dir, f));

describe('css scope rule', () => {
  it('Q-css-scope: the checker itself flags bare, universal, :root and unscoped selectors', () => {
    const css = `
      .products, .products-a .b { x: y }
      [data-remote="products"] th { x: y }
      @media (width < 40rem) { .products-x { a: b } table { a: b } }
      @keyframes spin { from { a: b } to { a: b } }
      th, :root, * , .other-x, .product-back { a: b }`;
    const bad = selectors(css).filter((s) => !scoped(s, 'products'));
    expect(bad).toEqual(['table', 'th', ':root', '*', '.other-x', '.product-back']);
  });

  for (const remote of ['products', 'dashboard']) {
    it(`Q-css-scope: every selector in apps/${remote}/src is under .${remote}-* or [data-remote="${remote}"]`, () => {
      const files = cssFiles(join(root, 'apps', remote, 'src'));
      expect(files.length, `${remote} has css`).toBeGreaterThan(0);
      const bad: string[] = [];
      for (const f of files) {
        const found = selectors(readFileSync(f, 'utf8'));
        expect(found.length, f).toBeGreaterThan(0);
        for (const s of found)
          if (!scoped(s, remote)) bad.push(`${f.slice(root.length + 1)}: ${s}`);
      }
      expect(bad).toEqual([]);
    });
  }
});

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
// T63: shape may need adapting in phase 2 (assumes measure(dist, app) keeps its signature).
import { measure } from '../../scripts/size-budget.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const gz = (s: string) => gzipSync(s, { level: 9 }).length;
const dist = (files: Record<string, string>) => {
  const d = mkdtempSync(join(tmpdir(), 'sb-'));
  dirs.push(d);
  writeFileSync(join(d, 'index.html'), '<script src="/main.js"></script>');
  for (const [f, c] of Object.entries(files)) writeFileSync(join(d, f), c);
  return d;
};
const css = '.a{color:red}'.repeat(50);
const js = 'console.log(1);'.repeat(50);

describe('size-budget dedupe', () => {
  it('Q-t63-budget: identical css files count once', () => {
    const m = measure(dist({ 'main.js': js, 'a.css': css, 'b.css': css }), 'shell');
    expect(m.cssGzip).toBe(gz(css));
  });

  it('Q-t63-budget: identical js files count once in totalJsGzip', () => {
    const m = measure(dist({ 'main.js': js, 'x.js': js }), 'shell');
    expect(m.totalJsGzip).toBe(gz(js));
  });

  it('Q-t63-budget: different content is still summed', () => {
    const other = css + '.b{}';
    const m = measure(dist({ 'main.js': js, 'a.css': css, 'b.css': other }), 'shell');
    expect(m.cssGzip).toBe(gz(css) + gz(other));
  });
});

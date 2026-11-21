// Black-box checks on the T40 logo assets: favicon files, README references, vercel cache rule.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToRegexp } from 'path-to-regexp';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const brand = join(root, 'packages/ui/brand');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('brand assets', () => {
  it('favicon.svg is an SVG with a 64x64 viewBox and a dark-mode media query', () => {
    const svg = readFileSync(join(brand, 'favicon.svg'), 'utf8');
    expect(svg).toMatch(/<svg[\s>]/);
    expect(svg).toContain('</svg>');
    expect(svg).toContain('viewBox="0 0 64 64"');
    expect(svg).toContain('prefers-color-scheme');
  });

  it.each([
    ['favicon-32.png', 32],
    ['apple-touch-icon.png', 180],
    ['icon-512.png', 512],
  ])('%s is a PNG of %i px square', (file, size) => {
    const b = readFileSync(join(brand, file));
    expect(b.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    expect(b.subarray(12, 16).toString('latin1')).toBe('IHDR');
    expect(b.readUInt32BE(16)).toBe(size);
    expect(b.readUInt32BE(20)).toBe(size);
  });
});

describe('README logo', () => {
  it('references both logo files and both exist', () => {
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    for (const f of ['docs/img/logo.svg', 'docs/img/logo-light.svg']) {
      expect(readme, f).toContain(f);
      expect(existsSync(join(root, f)), f).toBe(true);
    }
  });
});

describe('vercel cache rule', () => {
  it('the immutable rule never matches the unhashed icon files', () => {
    for (const app of ['shell', 'products', 'dashboard', 'orders']) {
      const cfg = JSON.parse(readFileSync(join(root, 'apps', app, 'vercel.json'), 'utf8')) as {
        headers: { source: string; headers: { value: string }[] }[];
      };
      const immutable = cfg.headers
        .filter((h) => h.headers.some((x) => /immutable/.test(x.value)))
        .map((h) => pathToRegexp(h.source));
      expect(immutable.length, app).toBeGreaterThan(0);
      for (const p of [
        '/favicon.svg',
        '/favicon-32.png',
        '/apple-touch-icon.png',
        '/icon-512.png',
      ]) {
        for (const re of immutable) expect(re.test(p), `${app} ${p}`).toBe(false);
      }
    }
  });
});

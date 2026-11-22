// Q-preview-rewrite: PREVIEW_API_URL points the shell's /api rewrite at the preview API; unset, output is the committed config.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const tmp: string[] = [];
afterAll(() => tmp.forEach((d) => rmSync(d, { recursive: true, force: true })));
const gen = (extra: Record<string, string>) => {
  const d = mkdtempSync(join(tmpdir(), 'vc-'));
  tmp.push(d);
  const env = { ...process.env, ...extra };
  if (!extra.PREVIEW_API_URL) delete env.PREVIEW_API_URL;
  execFileSync('node', ['scripts/vercel-config.ts', d], { cwd: root, env });
  return (app: string) => readFileSync(join(d, 'apps', app, 'vercel.json'), 'utf8');
};
const PREVIEW = 'https://mfe-lab-api-pr-42.vercel.app';
const rewrites = (s: string) =>
  (JSON.parse(s) as { rewrites: { source: string; destination: string }[] }).rewrites;

describe('vercel-config preview rewrite', () => {
  it('Q-preview-rewrite: with PREVIEW_API_URL every static app rewrites /api to it', () => {
    const f = gen({ PREVIEW_API_URL: PREVIEW });
    for (const app of ['shell', 'products', 'dashboard', 'orders']) {
      const r = rewrites(f(app)).find((x) => x.source === '/api/:path*');
      expect(r?.destination, app).toBe(`${PREVIEW}/:path*`);
    }
  });

  it('Q-preview-rewrite: without it the output equals the committed files (parsed; prettier reformats the committed copies)', () => {
    const f = gen({});
    for (const app of ['shell', 'products', 'dashboard', 'orders', 'api'])
      expect(JSON.parse(f(app)), app).toEqual(
        JSON.parse(readFileSync(join(root, 'apps', app, 'vercel.json'), 'utf8')),
      );
  });

  it('Q-preview-rewrite: only the rewrite target differs from production', () => {
    const p = JSON.parse(gen({ PREVIEW_API_URL: PREVIEW })('shell'));
    const c = JSON.parse(readFileSync(join(root, 'apps/shell/vercel.json'), 'utf8'));
    expect({ ...p, rewrites: 0 }).toEqual({ ...c, rewrites: 0 });
  });
});

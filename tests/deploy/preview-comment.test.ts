// Q-preview-comment + Q-preview-urls: black-box tests from the T43 contract (names are assumptions, see PR notes).
// ASSUMED scripts/preview-urls.ts:
//   previewHost(app, pr) -> '<project>-pr-<n>.vercel.app' (deterministic, no scheme)
//   previewUrls(pr, changed: App[]) -> Record<App, { url: string; kind: 'preview' | 'production' }>
// ASSUMED scripts/preview-comment.ts:
//   MARKER === '<!-- mfe-lab-preview -->'
//   previewComment({ pr, sha, neonBranch, changed, smoke: 'passed' | 'failed', state?: 'open' | 'closed',
//                    unavailable?: string }) -> string
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MARKER, previewComment } from '../../scripts/preview-comment.ts';
import { previewEnv, previewHost, previewUrls } from '../../scripts/preview-urls.ts';

const root = resolve(import.meta.dirname, '../..');
const prod = JSON.parse(readFileSync(resolve(root, 'deploy/urls.json'), 'utf8')) as Record<
  string,
  string
>;
const APPS = ['shell', 'products', 'dashboard', 'orders', 'api'] as const;
const SHA = '0123456789abcdef0123456789abcdef01234567';
const base = { pr: 42, sha: SHA, neonBranch: 'preview/pr-42', changed: ['shell', 'api', 'orders'] };
const rowOf = (body: string, app: string) =>
  body
    .split('\n')
    .find((l: string) => l.startsWith('|') && new RegExp(`\\b${app}\\b`, 'i').test(l)) ?? '';

describe('preview urls', () => {
  it('Q-preview-urls: hosts are deterministic *.vercel.app names containing the PR number', () => {
    for (const app of APPS) {
      const h = previewHost(app, 42);
      expect(h).toMatch(/^[a-z0-9-]+\.vercel\.app$/);
      expect(h).toContain('-pr-42.');
      expect(previewHost(app, 42)).toBe(h);
      expect(previewHost(app, 43)).not.toBe(h);
    }
    expect(new Set(APPS.map((a) => previewHost(a, 42))).size).toBe(APPS.length);
    expect(previewHost('shell', 7)).toBe('mfe-lab-pr-7.vercel.app');
    expect(previewHost('api', 7)).toBe('mfe-lab-api-pr-7.vercel.app');
    expect(previewHost('orders', 7)).toBe('mfe-lab-orders-pr-7.vercel.app');
  });

  it('Q-preview-urls: changed apps get preview URLs, unchanged ones the production URL', () => {
    const u = previewUrls(42, ['products'] as never);
    for (const app of APPS) {
      if (app === 'products') {
        expect(u[app].kind).toBe('preview');
        expect(u[app].url).toBe(`https://${previewHost(app, 42)}`);
      } else if (app === 'shell' || app === 'api') {
        // shell and api are always previews
        expect(u[app].kind, app).toBe('preview');
      } else {
        expect(u[app]).toEqual({ url: prod[app], kind: 'production' });
      }
    }
  });
});

describe('preview comment', () => {
  it('Q-preview-comment: carries the hidden marker, shell link, branch, short sha, demo login', () => {
    const b = previewComment(base as never);
    expect(MARKER).toBe('<!-- mfe-lab-preview -->');
    expect(b).toContain(MARKER);
    expect(b).toContain(`https://${previewHost('shell', 42)}`);
    expect(b).toContain('preview/pr-42');
    expect(b).toContain(SHA.slice(0, 7));
    expect(b).toContain('admin@lab.test');
    expect(b).toContain('lab12345');
    expect(b).toMatch(/demo/i);
  });

  it('Q-preview-comment: one row per app labelled preview or production by the changed set', () => {
    const b = previewComment(base as never);
    for (const app of APPS) {
      const rows = b
        .split('\n')
        .filter((l: string) => l.startsWith('|') && new RegExp(`\\b${app}\\b`, 'i').test(l));
      expect(rows, app).toHaveLength(1);
    }
    for (const app of ['shell', 'orders', 'api']) expect(rowOf(b, app), app).toMatch(/preview/i);
    for (const app of ['products', 'dashboard']) {
      const r = rowOf(b, app);
      expect(r, app).toMatch(/production/i);
      expect(r, app).not.toMatch(/preview/i);
      expect(r, app).toContain(prod[app]);
    }
  });

  it('Q-preview-comment: shows the smoke result, including failure', () => {
    const ok = previewComment({ ...base, smoke: 'passed' } as never);
    const bad = previewComment({ ...base, smoke: 'failed' } as never);
    expect(ok).toMatch(/smoke/i);
    expect(bad).toMatch(/smoke/i);
    expect(bad).toMatch(/fail/i);
    expect(ok).not.toMatch(/fail/i);
  });

  it('Q-preview-comment: closed state says "Preview removed", keeps the marker, has no URLs', () => {
    const b = previewComment({ ...base, state: 'closed' } as never);
    expect(b).toContain(MARKER);
    expect(b).toContain('Preview removed');
    expect(b).not.toMatch(/https?:\/\//);
    expect(b).not.toMatch(/vercel\.app/);
  });

  it('Q-preview-comment: unavailable preview says "preview unavailable: <reason>"', () => {
    const b = previewComment({ ...base, unavailable: 'branch limit reached' } as never);
    expect(b).toContain(MARKER);
    expect(b).toContain('preview unavailable: branch limit reached');
  });

  it('Q-preview-comment: is pure and deterministic', () => {
    expect(previewComment(base as never)).toBe(previewComment({ ...base } as never));
  });
});

describe('preview env', () => {
  it('Q-preview-urls: previewEnv points changed remotes at previews, the rest at production manifests', () => {
    const env = previewEnv(42, ['products']);
    expect(env).toContain(
      `MF_PRODUCTS_URL=https://${previewHost('products', 42)}/mf-manifest.json`,
    );
    expect(env).toContain(`MF_DASHBOARD_URL=${prod.dashboard}/mf-manifest.json`);
    expect(env).toContain(`MF_ORDERS_URL=${prod.orders}/mf-manifest.json`);
    expect(env).toContain(`PREVIEW_SHELL_URL=https://${previewHost('shell', 42)}`);
    expect(env).toContain(`PREVIEW_API_URL=https://${previewHost('api', 42)}`);
  });
});

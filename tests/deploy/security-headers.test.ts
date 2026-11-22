// Q-headers (static): shell vercel.json, generated config and nginx template carry the T46 headers (CSP on `/(.*)`, nosniff and CORS * on remote entries).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToRegexp } from 'path-to-regexp';
import { afterAll, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
type Cfg = { headers?: { source: string; headers: { key: string; value: string }[] }[] };
const load = (base: string, app: string) =>
  JSON.parse(readFileSync(join(base, 'apps', app, 'vercel.json'), 'utf8')) as Cfg;
const headersFor = (cfg: Cfg, path: string) =>
  Object.fromEntries(
    (cfg.headers ?? [])
      .filter((h) => pathToRegexp(h.source).test(path))
      .flatMap((h) => h.headers.map((x) => [x.key.toLowerCase(), x.value])),
  );
const urls = JSON.parse(readFileSync(join(root, 'deploy/urls.json'), 'utf8')) as Record<
  string,
  string
>;

const tmp = mkdtempSync(join(tmpdir(), 'mfe-sec-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
execFileSync('node', ['scripts/vercel-config.ts', tmp], { cwd: root });

const directive = (csp: string, name: string): string[] =>
  (
    csp
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .find((d) => d[0] === name) ?? []
  ).slice(1);

const checkCsp = (csp: string) => {
  expect(directive(csp, 'default-src')).toEqual(["'self'"]);
  expect(directive(csp, 'frame-ancestors')).toEqual(["'none'"]);
  expect(directive(csp, 'base-uri')).toEqual(["'self'"]);
  expect(directive(csp, 'form-action')).toEqual(["'self'"]);
  expect(directive(csp, 'img-src')).toEqual(expect.arrayContaining(["'self'", 'data:']));
  expect(directive(csp, 'font-src')).toEqual(["'self'"]);
  for (const d of ['script-src', 'connect-src']) {
    const v = directive(csp, d);
    expect(v, d).toContain("'self'");
    for (const r of ['products', 'dashboard', 'orders'])
      expect(v.join(' '), `${d} ${r}`).toContain(urls[r]!.replace(/\/$/, ''));
    expect(v, d).not.toContain('*');
    expect(v, d).not.toContain("'unsafe-eval'");
    expect(v, d).not.toContain("'unsafe-inline'");
  }
};

describe('security headers', () => {
  it('Q-headers: committed and generated shell config send CSP, nosniff and Referrer-Policy', () => {
    for (const base of [root, tmp]) {
      const h = headersFor(load(base, 'shell'), '/');
      checkCsp(h['content-security-policy'] ?? '');
      expect(h['x-content-type-options']).toBe('nosniff');
      expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
      // also on deep SPA routes
      expect(
        headersFor(load(base, 'shell'), '/products/1')['content-security-policy'],
      ).toBeTruthy();
    }
  });

  it('Q-headers: remotes keep CORS * on entry files and add nosniff', () => {
    for (const app of ['products', 'dashboard', 'orders']) {
      for (const p of ['/mf-manifest.json', '/remoteEntry.js']) {
        const h = headersFor(load(root, app), p);
        expect(h['access-control-allow-origin'], `${app} ${p}`).toBe('*');
        expect(h['x-content-type-options'], `${app} ${p}`).toBe('nosniff');
      }
    }
  });

  it('Q-headers: the nginx template sets the same headers', () => {
    const t = readFileSync(join(root, 'docker/nginx.conf.template'), 'utf8');
    const m = /add_header\s+Content-Security-Policy\s+"([^"]+)"\s+always;/i.exec(t);
    expect(m, 'CSP add_header with a quoted value and `always`').not.toBeNull();
    expect(directive(m![1]!, 'frame-ancestors')).toEqual(["'none'"]);
    expect(directive(m![1]!, 'default-src')).toEqual(["'self'"]);
    expect(t).toMatch(/add_header\s+X-Content-Type-Options\s+"?nosniff"?\s+always;/i);
    expect(t).toMatch(
      /add_header\s+Referrer-Policy\s+"?strict-origin-when-cross-origin"?\s+always;/i,
    );
  });
});

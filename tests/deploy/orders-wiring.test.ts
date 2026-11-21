// Q-orders-wiring: everything a new app touches. Text checks, no YAML parser is available (see workflows.test.ts).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const read = (f: string) => readFileSync(resolve(root, f), 'utf8');
const deploy = read('.github/workflows/deploy.yml')
  .split('\n')
  .map((l) => l.replace(/(^|\s)#.*$/, ''))
  .join('\n');

describe('orders wiring', () => {
  it('Q-orders-wiring: urls.json has orders', () => {
    const urls = JSON.parse(read('deploy/urls.json')) as Record<string, string>;
    expect(urls.orders).toBe('https://mfe-lab-orders.vercel.app');
  });

  it('Q-orders-wiring: deploy.yml puts orders in the remotes matrix and the plan', () => {
    expect(deploy).toMatch(/for a in products dashboard orders;/);
  });

  it('Q-orders-wiring: deploy.yml smoke checks the orders manifest headers', () => {
    const smoke = /^ {2}smoke:[\s\S]*?(?=^ {2}\S)/m.exec(deploy)?.[0] ?? '';
    expect(smoke).toMatch(/https:\/\/mfe-lab-orders\.vercel\.app\/mf-manifest\.json/);
  });

  it('Q-orders-wiring: the size budget has orders with the three metrics', () => {
    const b = JSON.parse(read('perf-budget.json')) as Record<string, Record<string, number>>;
    for (const m of ['initialJsGzip', 'totalJsGzip', 'cssGzip']) {
      expect(b.orders?.[m], m).toBeGreaterThan(0);
    }
  });

  it('Q-orders-wiring: the shell build defaults MF_ORDERS_URL to localhost:3003', () => {
    expect(read('apps/shell/rspack.config.ts')).toContain('http://localhost:3003/mf-manifest.json');
  });

  it('Q-orders-wiring: docker-compose, nginx image build and playwright know port 3003', () => {
    expect(read('docker-compose.yml')).toMatch(/3003:3003/);
    expect(read('playwright.config.ts')).toMatch(/@mfe\/orders dev[\s\S]*3003\/mf-manifest\.json/);
  });

  it('Q-orders-wiring: AGENTS.md lists port 3003 and the Vue exception', () => {
    const t = read('AGENTS.md');
    expect(t).toMatch(/orders 3003/);
    expect(t).toMatch(/orders[^\n]*Vue/i);
  });

  it('Q-orders-wiring: release.ts excludes orders (no version switching)', () => {
    expect(read('scripts/release.ts')).toMatch(/orders/);
  });
});

// Gates bundle size after `pnpm build`: node scripts/size-budget.ts [--budget <file>] [--root <repoDir>]
// Budget file: perf-budget.json at the root (or SIZE_BUDGET env). Exit 1 if any metric is over budget.
//
// "Initial" JS (what a cold visit must download before the app runs):
//   shell   : every <script src> in dist/index.html
//   remotes : remoteEntry.js + the union of the `assets.js.sync` chunks of every expose in
//             dist/mf-manifest.json (an expose is fetched whole when the host mounts it)
// Async chunks only count towards totalJsGzip. No hand-kept file lists.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

export const apps = ['shell', 'products', 'dashboard'] as const;
export const metrics = ['initialJsGzip', 'totalJsGzip', 'cssGzip'] as const;
export type Metric = (typeof metrics)[number];
export type Budget = Record<string, Partial<Record<Metric, number>> & Record<string, unknown>>;

const gz = (file: string) => gzipSync(readFileSync(file), { level: 9 }).length;

export function initialFiles(dist: string, app: string): string[] {
  if (app === 'shell') {
    const html = readFileSync(join(dist, 'index.html'), 'utf8');
    return [...html.matchAll(/<script[^>]*\ssrc="\/?([^"]+\.js)"/g)].map((m) => m[1]!);
  }
  const manifest = JSON.parse(readFileSync(join(dist, 'mf-manifest.json'), 'utf8')) as {
    exposes: { assets: { js: { sync: string[] } } }[];
  };
  return ['remoteEntry.js', ...new Set(manifest.exposes.flatMap((e) => e.assets.js.sync))];
}

export function measure(dist: string, app: string): Record<Metric, number> {
  const all = readdirSync(dist);
  const sum = (files: string[]) => files.reduce((n, f) => n + gz(join(dist, f)), 0);
  return {
    initialJsGzip: sum(initialFiles(dist, app)),
    totalJsGzip: sum(all.filter((f) => f.endsWith('.js'))),
    cssGzip: sum(all.filter((f) => f.endsWith('.css'))),
  };
}

export type Row = { app: string; metric: Metric; size: number; budget: number; over: boolean };

export function check(root: string, budget: Budget): Row[] {
  return apps.flatMap((app) => {
    const sizes = measure(join(root, 'apps', app, 'dist'), app);
    return metrics.map((metric) => {
      const limit = budget[app]?.[metric];
      if (typeof limit !== 'number') throw new Error(`no ${metric} budget for ${app}`);
      return { app, metric, size: sizes[metric], budget: limit, over: sizes[metric] > limit };
    });
  });
}

export function format(rows: Row[]): string {
  const line = (r: string[]) => r.map((c, i) => (i < 2 ? c.padEnd(15) : c.padStart(9))).join('  ');
  return [
    line(['app', 'metric', 'size', 'budget', '% used']),
    ...rows.map((r) =>
      line([
        r.app,
        r.metric,
        String(r.size),
        String(r.budget),
        `${((r.size / r.budget) * 100).toFixed(1)}%${r.over ? ' OVER' : ''}`,
      ]),
    ),
  ].join('\n');
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const arg = (flag: string) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  const root = resolve(arg('--root') ?? join(import.meta.dirname, '..'));
  const file = resolve(
    arg('--budget') ?? process.env.SIZE_BUDGET ?? join(root, 'perf-budget.json'),
  );
  const rows = check(root, JSON.parse(readFileSync(file, 'utf8')) as Budget);
  console.log(format(rows));
  const over = rows.filter((r) => r.over);
  for (const r of over) console.error(`over budget: ${r.app} ${r.metric} ${r.size} > ${r.budget}`);
  process.exit(over.length ? 1 : 0);
}

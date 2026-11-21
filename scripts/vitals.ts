// Lab Web Vitals against a live deploy: node scripts/vitals.ts [--budget <file>]
// Base URL: VITALS_URL, else the shell URL in deploy/urls.json. Runs: VITALS_RUNS (default 5).
// Fast 4G (150 ms, 1.6/0.75 Mbps, as RFC 0005) + 4x CPU, fresh empty-cache context per run, median of runs.
// Measures /login cold (LCP, CLS until 3 s after load) and the home page after sign-in
// (time-to-remotes: submit -> first products row AND the dashboard chart visible; CLS of that step).
// Budgets: perf-budget.json "vitals". Exit 1 if a median is over budget. Demo logins only (see README).
import { appendFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

export const metricNames = ['lcpMs', 'clsLogin', 'timeToRemotesMs', 'clsHome'] as const;
export type MetricName = (typeof metricNames)[number];
export type Sample = Record<MetricName, number>;
export type Budgets = Record<MetricName, number>;

export const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
// Nearest rank.
export const p90 = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.ceil(0.9 * s.length) - 1]!;
};

export type Row = {
  metric: MetricName;
  median: number;
  p90: number;
  budget: number;
  over: boolean;
};

export function compare(samples: Sample[], budgets: Budgets): Row[] {
  return metricNames.map((metric) => {
    const xs = samples.map((s) => s[metric]);
    const m = median(xs);
    return { metric, median: m, p90: p90(xs), budget: budgets[metric], over: m > budgets[metric] };
  });
}

const fmt = (metric: MetricName, v: number) =>
  metric.endsWith('Ms') ? `${Math.round(v)} ms` : v.toFixed(3);

export function summary(rows: Row[]): string {
  return [
    '| metric | median | p90 | budget | |',
    '| --- | ---: | ---: | ---: | --- |',
    ...rows.map(
      (r) =>
        `| ${r.metric} | ${fmt(r.metric, r.median)} | ${fmt(r.metric, r.p90)} | ${fmt(r.metric, r.budget)} | ${r.over ? 'OVER' : 'ok'} |`,
    ),
  ].join('\n');
}

// Runs in the page before any script: collects LCP and layout shifts, times the sign-in.
const initScript = () => {
  const w = window as unknown as Record<string, number | undefined>;
  w.__lcp = 0;
  w.__cls = 0;
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) w.__lcp = e.startTime;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean }[])
      if (!e.hadRecentInput) w.__cls = (w.__cls ?? 0) + e.value;
  }).observe({ type: 'layout-shift', buffered: true });
  const shown = (sel: string) => {
    const el = document.querySelector(sel);
    return !!el && el.getBoundingClientRect().width > 0;
  };
  const start = () => {
    if (w.__t0 !== undefined) return;
    w.__t0 = performance.now();
    w.__clsAtStart = w.__cls;
    const tick = () => {
      if (
        shown('section[data-remote="products"] tbody tr') &&
        shown('section[data-remote="dashboard"] svg[role="img"]')
      ) {
        w.__ttr = performance.now() - w.__t0!;
        w.__clsHome = (w.__cls ?? 0) - (w.__clsAtStart ?? 0);
      } else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  document.addEventListener('submit', start, true);
  document.addEventListener(
    'click',
    (e) => {
      if ((e.target as Element).closest('button[type="submit"]')) start();
    },
    true,
  );
};

async function run(base: string): Promise<Sample> {
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext()).newPage();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.addInitScript(initScript);
    await page.goto(`${base}/login`, { waitUntil: 'load' });
    await page.waitForTimeout(3000);
    const login = await page.evaluate(() => {
      const w = window as unknown as Record<string, number>;
      return { lcpMs: w.__lcp!, clsLogin: w.__cls! };
    });
    await page.getByLabel('Email').fill('admin@lab.test');
    await page.getByLabel('Password').fill('lab12345');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForFunction(
      () => (window as unknown as Record<string, number>).__ttr !== undefined,
      null,
      {
        timeout: 60_000,
      },
    );
    const home = await page.evaluate(() => {
      const w = window as unknown as Record<string, number>;
      return { timeToRemotesMs: w.__ttr!, clsHome: w.__clsHome! };
    });
    return { ...login, ...home };
  } finally {
    await browser.close();
  }
}

if (import.meta.main) {
  const root = resolve(import.meta.dirname, '..');
  const argv = process.argv.slice(2);
  const bFlag = argv.indexOf('--budget');
  const budgetFile = bFlag >= 0 ? resolve(argv[bFlag + 1]!) : join(root, 'perf-budget.json');
  const budgets = (JSON.parse(readFileSync(budgetFile, 'utf8')) as { vitals: Budgets }).vitals;
  const base = (
    process.env.VITALS_URL ??
    (JSON.parse(readFileSync(join(root, 'deploy/urls.json'), 'utf8')) as { shell: string }).shell
  ).replace(/\/$/, '');
  const n = Number(process.env.VITALS_RUNS ?? 5);
  const samples: Sample[] = [];
  for (let i = 0; i < n; i++) {
    samples.push(await run(base));
    console.log(`run ${i + 1}/${n}`, JSON.stringify(samples.at(-1)));
  }
  const rows = compare(samples, budgets);
  const table = summary(rows);
  console.log(`\n${base}\n${table}`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Web Vitals (${base}, Fast 4G, 4x CPU, ${n} runs)\n\n${table}\n`,
    );
  for (const r of rows.filter((r) => r.over))
    console.error(
      `over budget: ${r.metric} median ${fmt(r.metric, r.median)} > ${fmt(r.metric, r.budget)}`,
    );
  process.exit(rows.some((r) => r.over) ? 1 : 0);
}

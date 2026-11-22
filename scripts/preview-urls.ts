// URL derivation for PR previews (preview.yml).
//   node scripts/preview-urls.ts env <pr> [changed apps...]   KEY=value lines for GITHUB_ENV: MF_*_URL, PREVIEW_*_URL
//   node scripts/preview-urls.ts hosts <pr>                   "<app> <alias host>" for the five apps
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APPS, type App } from './changed-apps.ts';

export type Urls = Record<App, string>;
export type Kind = 'preview' | 'production';
const prod: Urls = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'deploy', 'urls.json'), 'utf8'),
);

// Stable alias host of an app for PR n: the production host with "-pr-<n>" before ".vercel.app".
export const previewHost = (app: App, pr: number | string, urls: Urls = prod) =>
  new URL(urls[app]).hostname.replace(/\.vercel\.app$/, `-pr-${pr}.vercel.app`);

// The shell and the api always get a preview; a remote only when the PR changed it.
export function previewUrls(
  pr: number | string,
  changed: readonly string[],
  urls: Urls = prod,
): Record<App, { url: string; kind: Kind }> {
  return Object.fromEntries(
    APPS.map((app) => {
      const preview = app === 'shell' || app === 'api' || changed.includes(app);
      return [
        app,
        preview
          ? { url: `https://${previewHost(app, pr, urls)}`, kind: 'preview' }
          : { url: urls[app], kind: 'production' },
      ];
    }),
  ) as Record<App, { url: string; kind: Kind }>;
}

// MF_*_URL are manifest URLs, as in deploy.yml.
export function previewEnv(pr: number | string, changed: readonly string[]) {
  const u = previewUrls(pr, changed);
  return [
    ...(['products', 'dashboard', 'orders'] as const).map(
      (a) => `MF_${a.toUpperCase()}_URL=${u[a].url}/mf-manifest.json`,
    ),
    `PREVIEW_SHELL_URL=${u.shell.url}`,
    `PREVIEW_API_URL=${u.api.url}`,
  ];
}

if (import.meta.main) {
  const [cmd, pr, ...changed] = process.argv.slice(2);
  if (cmd === 'env') console.log(previewEnv(pr!, changed).join('\n'));
  else if (cmd === 'hosts') for (const a of APPS) console.log(`${a} ${previewHost(a, pr!)}`);
  else {
    console.error('usage: preview-urls.ts env <pr> [apps...] | hosts <pr>');
    process.exit(1);
  }
}

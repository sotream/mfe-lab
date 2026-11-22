// The preview API must run on the PR's Neon branch, never on production.
//   node scripts/preview-guard.ts <deployment-url>   env: PREVIEW_DB_ID
// preview.yml runs it on the raw deployment URL before `vercel alias set`; preview-smoke.ts reuses the check.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function assertPreviewDb(db: string | undefined, id: string | undefined, prodDb?: string) {
  if (!db || db !== id || db === prodDb)
    throw new Error('preview API is not on the PR branch (would hit production DB)');
}

if (import.meta.main) {
  const url = process.argv[2];
  if (!url) throw new Error('usage: preview-guard.ts <deployment-url>');
  const prod = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'deploy', 'urls.json'), 'utf8'),
  ) as { api: string };
  // A fresh deployment can take a moment to answer.
  let res: Response | undefined;
  for (let i = 0; i < 6 && !res?.ok; i++) {
    if (i) await new Promise((r) => setTimeout(r, 5000));
    res = await fetch(`${url}/health`, { redirect: 'manual' }).catch(() => undefined);
  }
  if (!res?.ok) throw new Error(`${url}/health answers ${res?.status ?? 'nothing'}`);
  const prodDb = ((await (await fetch(`${prod.api}/health`)).json()) as { db?: string }).db;
  assertPreviewDb(((await res.json()) as { db?: string }).db, process.env.PREVIEW_DB_ID, prodDb);
  console.log('preview db guard ok');
}

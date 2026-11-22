// Smoke on a PR preview: node scripts/preview-smoke.ts <shell-url> <api-url>
// Env PREVIEW_DB_ID: dbFingerprint of the PR branch URL. The API answers, the demo admin signs in, and all three remote frames render real content. Demo logins only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { assertPreviewDb } from './preview-guard.ts';

const prod = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'deploy', 'urls.json'), 'utf8'),
) as { api: string };
const [shell, api] = process.argv.slice(2);
if (!shell || !api) throw new Error('usage: preview-smoke.ts <shell-url> <api-url>');

const res = await fetch(`${api}/health`, { redirect: 'manual' });
if (res.status === 401 || res.status === 403)
  throw new Error(
    `${api}/health answers ${res.status}: Vercel deployment protection blocks the preview (ask the owner to allow it)`,
  );
if (!res.ok) throw new Error(`${api}/health answers ${res.status}`);

// Before anything is written: the preview API must be on the PR's Neon branch, never on production.
const prodHealth = await fetch(`${prod.api}/health`);
const prodDb = ((await prodHealth.json()) as { db?: string }).db;
const { db } = (await res.json()) as { db?: string };
assertPreviewDb(db, process.env.PREVIEW_DB_ID, prodDb);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`${shell}/login`);
  await page.getByLabel('Email').fill('admin@lab.test');
  await page.getByLabel('Password').fill('lab12345');
  await page.getByRole('button', { name: 'Sign in' }).click();
  const frame = (name: string) => page.locator(`section[data-remote="${name}"]`);
  const t = { timeout: 60_000 };
  await frame('products').locator('tbody tr').first().waitFor(t);
  await frame('dashboard').locator('svg[role="img"]').first().waitFor(t);
  await page.getByRole('navigation').getByRole('link', { name: 'Orders', exact: true }).click();
  await frame('orders').locator('tbody tr').first().waitFor(t);
  console.log('preview smoke ok');
} finally {
  await browser.close();
}

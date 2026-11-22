import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// T42: a remote opened on its own port has exactly one visible h1 (EN/DE by locale);
// inside the shell the shell owns the only h1 (RFC 0011).
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const PAGES = [
  { name: 'products list', url: 'http://localhost:3001/', en: 'Products', de: 'Produkte' },
  { name: 'products detail', url: 'http://localhost:3001/1', en: 'Products', de: 'Produkte' },
  { name: 'dashboard', url: 'http://localhost:3002/', en: 'Dashboard', de: 'Dashboard' },
  { name: 'orders', url: 'http://localhost:3003/', en: 'Orders', de: 'Bestellungen' },
];

// The first hit on a cold dev server can land mid-recompile (HMR ChunkLoadError after the e2e
// release step), leaving a blank page: reload once if nothing rendered.
async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  const rendered = await page
    .locator('h1')
    .first()
    .waitFor({ timeout: 5000 })
    .then(
      () => true,
      () => false,
    );
  if (!rendered) await page.reload();
}

async function expectOneH1(page: Page, text: string): Promise<void> {
  const h1 = page.locator('h1'); // pierces open shadow roots
  await expect(h1).toHaveCount(1);
  await expect(h1).toBeVisible();
  await expect(h1).toHaveText(text);
}

async function expectAxeClean(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    'axe violations',
  ).toEqual([]);
  // page-has-heading-one is a moderate rule, so check it explicitly.
  expect(violations.map((v) => v.id)).not.toContain('page-has-heading-one');
}

for (const p of PAGES) {
  test(`E-standalone-h1: ${p.name} has one h1 "${p.en}" and is axe-clean`, async ({ page }) => {
    await open(page, p.url);
    await expectOneH1(page, p.en);
    await expectAxeClean(page);
  });

  test.describe(`German browser: ${p.name}`, () => {
    test.use({ locale: 'de-DE' });
    test(`E-standalone-h1: ${p.name} has one h1 "${p.de}"`, async ({ page }) => {
      await open(page, p.url);
      await expectOneH1(page, p.de);
    });
  });
}

test('E-shell-one-h1: the shell owns the only h1 on every page, remotes mounted', async ({
  page,
}) => {
  // The token lives in memory (RFC 0002): navigate with the in-app links, never page.goto after login.
  await page.goto('http://localhost:3000/login');
  await page.locator('input[type="email"]').fill('admin@lab.test');
  await page.locator('input[type="password"]').fill('lab12345');
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByText('admin@lab.test', { exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);
  const nav = page.getByRole('navigation');
  const links: [string, string | null][] = [
    ['Home', 'products'],
    ['Products', 'products'],
    ['Dashboard', 'dashboard'],
    ['Orders', 'orders'],
    ['Inspector', null],
  ];
  for (const [name, remote] of links) {
    await nav.getByRole('link', { name, exact: true }).click();
    if (remote) await expect(page.locator(`section[data-remote="${remote}"]`)).toBeVisible();
    await expect(page.locator('h1'), name).toHaveCount(1);
    await expect(page.locator('h1'), name).toBeVisible();
  }
});

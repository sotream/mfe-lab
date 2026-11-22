// T52 E-demo-axe: axe on the locked demo admin UI. The API has no second demo account in e2e, so the
// login and /auth/me responses are rewritten to carry user.demo = true (the backend lock has API tests).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const BASE = 'http://localhost:3000';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const CHIP = {
  en: 'Demo admin: changes that affect everyone are disabled',
  de: 'Demo-Admin: Änderungen, die alle betreffen, sind deaktiviert',
};

async function asDemoAdmin(page: Page, locale: 'en' | 'de'): Promise<void> {
  await page.addInitScript((l) => localStorage.setItem('mfe-lab:locale', l), locale);
  const rewrite = async (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
    const res = await route.fetch();
    const body = (await res.json()) as { user: Record<string, unknown> };
    await route.fulfill({ response: res, json: { ...body, user: { ...body.user, demo: true } } });
  };
  await page.route('**/api/auth/login', rewrite);
  await page.route('**/api/auth/me', rewrite);
  await page.goto(`${BASE}/login`);
  await page.locator('input[type="email"]').fill('admin@lab.test');
  await page.locator('input[type="password"]').fill('lab12345');
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByText('admin@lab.test', { exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/); // login's replace-navigation has landed
}

const problems: string[] = [];
async function scan(page: Page, where: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  for (const v of violations.filter((x) => x.impact === 'serious' || x.impact === 'critical'))
    problems.push(
      `${where}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
    );
}

const locked = async (loc: ReturnType<Page['locator']>) => {
  await expect(loc).toBeDisabled();
  await expect(loc).toHaveAttribute('aria-disabled', 'true');
};

for (const locale of ['en', 'de'] as const) {
  test(`E-demo-axe (${locale}): axe is clean on the locked demo admin UI`, async ({ page }) => {
    problems.length = 0;
    await asDemoAdmin(page, locale);

    const chip = page.locator('.chip--demo');
    await expect(chip).toHaveText(CHIP[locale]);
    await expect(page.locator('section[data-remote="products"] tbody tr').first()).toBeVisible();
    await scan(page, `${locale} Home`);

    await page.getByRole('navigation').locator('a[href="/inspector"]').click();
    await expect(chip).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const flags = page.locator('section.panel').filter({ has: page.locator('input.switch') });
    await expect(flags.locator('input.switch').first()).toBeVisible();
    for (const sw of await flags.locator('input.switch').all()) await locked(sw);
    await expect(flags.locator('.details-demo')).toHaveText(CHIP[locale]);
    await scan(page, `${locale} flags panel`);

    const errors = page
      .locator('section.panel')
      .filter({ has: page.locator('.panel-toolbar') })
      .filter({ hasNot: page.locator('input.switch') });
    await expect(errors.locator('.details-demo')).toHaveText(CHIP[locale]);
    await locked(errors.locator('.panel-toolbar button.ds1-button--sm').last()); // Clear follows Refresh
    await scan(page, `${locale} errors panel`);

    await page.locator('#details-products').click();
    const dialog = page.locator('dialog.details-dialog[open]');
    await expect(dialog).toBeVisible();
    for (const c of await dialog.locator('form input').all()) await locked(c);
    await locked(dialog.locator('button[type="submit"]'));
    await expect(dialog.locator('.details-demo')).toHaveText(CHIP[locale]);
    await scan(page, `${locale} details dialog`);

    expect(problems, `axe violations:\n${problems.join('\n')}`).toEqual([]);
  });
}

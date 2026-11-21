import { expect, test, type Page } from '@playwright/test';

const BASE = 'http://localhost:3000';

const products = (page: Page) => page.locator('section[data-remote="products"]');
const dashboard = (page: Page) => page.locator('section[data-remote="dashboard"]');

// Token and version selection live in memory: after login, move only via nav links.
async function pickVersion(page: Page, version: string): Promise<void> {
  await page.getByRole('link', { name: 'Inspector' }).click();
  // T38: custom select (role=combobox / role=option); '' is the "dev" entry
  await page.getByRole('combobox', { name: 'products version' }).click();
  await page.getByRole('option', { name: version || 'dev', exact: true }).click();
  await page.getByRole('link', { name: 'Home' }).click();
}

test.skip(process.env.E2E_TARGET === 'docker', 'nginx serves no releases/');

test('E-versions: switching the products version changes the mounted build', async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill('viewer@lab.test');
  await page.getByLabel('Password').fill('lab12345');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByRole('banner').getByText('viewer@lab.test', { exact: true }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/); // login's replace-navigation has landed

  for (const version of ['0.0.2-e2e', '0.0.1-e2e']) {
    await pickVersion(page, version);
    await expect(products(page)).toContainText(`build ${version}`);
    await expect(dashboard(page).locator('svg[role="img"] rect[data-date]').first()).toBeVisible();
  }

  await pickVersion(page, '');
  await expect(products(page)).toContainText('build ');
  await expect(products(page)).not.toContainText('e2e');
  await expect(dashboard(page).locator('svg[role="img"] rect[data-date]').first()).toBeVisible();
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const BASE = 'http://localhost:3000';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

// Collect serious/critical violations over all visited pages, then fail once with a readable list.
const problems: string[] = [];
async function scan(page: Page, where: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  for (const v of violations.filter((x) => x.impact === 'serious' || x.impact === 'critical'))
    problems.push(
      `${where}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
    );
}

test('E-a11y: axe finds no serious or critical WCAG A/AA violations', async ({ page }) => {
  problems.length = 0;
  await page.goto(`${BASE}/login`);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in to the shell' })).toBeVisible();
  await scan(page, '/login');

  await page.getByLabel('Email').fill('admin@lab.test');
  await page.getByLabel('Password').fill('lab12345');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('admin@lab.test', { exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/); // login's replace-navigation has landed

  const nav = page.getByRole('navigation');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'One page, three independent apps',
  );
  await expect(page.locator('section[data-remote="products"] tbody tr').first()).toBeVisible();
  await expect(page.locator('section[data-remote="dashboard"] svg[role="img"]')).toBeVisible();
  await scan(page, 'Home');

  await nav.getByRole('link', { name: 'Products' }).click();
  const products = page.locator('section[data-remote="products"]');
  await expect(page.getByRole('heading', { level: 1, name: 'Products' })).toBeVisible();
  await expect(products.locator('tbody tr').first()).toBeVisible();
  await scan(page, '/products');

  await products.locator('tbody tr').first().getByRole('link').first().click();
  await expect(page).toHaveURL(/\/products\/\d+$/);
  await expect(products.getByRole('heading', { level: 3 })).toBeVisible();
  await scan(page, '/products/:id');

  await nav.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await expect(page.locator('section[data-remote="dashboard"] svg[role="img"]')).toBeVisible();
  await scan(page, '/dashboard');

  await nav.getByRole('link', { name: 'Inspector' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Federation inspector' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'dashboard.revenue' })).toBeEnabled();
  await scan(page, '/inspector');

  expect(problems, `axe violations:\n${problems.join('\n')}`).toEqual([]);
});

test('E-skip-link: Tab then Enter on the skip link focuses main', async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main')).toBeFocused();
});

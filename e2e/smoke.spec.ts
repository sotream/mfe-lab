import { expect, test, type Page } from '@playwright/test';

const BASE = 'http://localhost:3000';

async function login(page: Page, email: string): Promise<void> {
  if (!page.url().startsWith(`${BASE}/login`)) await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('lab12345');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
}

const rowOf = (page: Page, name: string) =>
  page.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: true }) });
const products = (page: Page) => page.locator('section[data-remote="products"]');
const dashboard = (page: Page) => page.locator('section[data-remote="dashboard"]');

test('E-login: viewer logs in and lands on /', async ({ page }) => {
  await login(page, 'viewer@lab.test');
  await expect(page).toHaveURL(`${BASE}/`);
  await expect(page.getByText('viewer@lab.test', { exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/); // login's replace-navigation has landed
  await expect(page.getByText('viewer', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
});

test('E-remotes: both frames render real content with build stamps', async ({ page }) => {
  await login(page, 'viewer@lab.test');

  const p = products(page);
  await expect(p).toContainText('products');
  await expect(p).toContainText(':3001');
  await expect(p.locator('tbody tr').first()).toBeVisible();
  await expect(p).toContainText(/Page 1 of \d+/);
  await expect(p).toContainText('build ');

  const d = dashboard(page);
  await expect(d).toContainText('dashboard');
  await expect(d).toContainText(':3002');
  await expect(d.getByRole('figure').filter({ hasText: 'Orders per day' })).toBeVisible();
  await expect(d.locator('svg[role="img"] rect[data-date]').first()).toBeVisible();
  const tiles = d.locator('dl');
  for (const label of ['Products', 'Orders', 'Revenue', 'Paid revenue']) {
    await expect(tiles.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(d).toContainText('build ');

  await expect(page.locator('footer')).toContainText('shell');
  await expect(page.locator('footer')).toContainText('build ');
  await expect(page.locator('footer')).not.toContainText('·');
});

test('E-shared-auth: remote sees the shell login role', async ({ page }) => {
  await login(page, 'viewer@lab.test');
  await expect(products(page).locator('tbody tr').first()).toBeVisible();
  await expect(products(page).getByRole('button', { name: 'Add product' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await login(page, 'editor@lab.test');
  await expect(products(page).getByRole('button', { name: 'Add product' })).toBeVisible();
});

test('E-kill-remote: dead products remote degrades, then recovers', async ({ page }) => {
  await page.route('http://localhost:3001/**', (r) => r.abort('connectionrefused'));
  await login(page, 'viewer@lab.test');

  const alert = products(page).getByRole('alert');
  await expect(alert).toContainText('products is unavailable');
  await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(dashboard(page).locator('svg[role="img"] rect[data-date]').first()).toBeVisible();

  await page.getByRole('link', { name: 'Inspector' }).click();
  await expect(
    rowOf(page, 'products').getByRole('cell', { name: 'down', exact: true }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Home' }).click();
  await expect(products(page).getByRole('alert')).toContainText('products is unavailable');

  await page.unroute('http://localhost:3001/**');
  await products(page).getByRole('button', { name: 'Retry' }).click();
  await expect(products(page).locator('tbody tr').first()).toBeVisible();
});

test('E-inspector: remotes up and shared deps loaded once', async ({ page }) => {
  await page.goto(`${BASE}/inspector`);
  for (const name of ['products', 'dashboard']) {
    await expect(rowOf(page, name).getByRole('cell', { name: 'up', exact: true })).toBeVisible();
  }
  for (const dep of ['@mfe/auth-store', 'react', 'react-dom', 'react-router']) {
    await expect(
      rowOf(page, dep).getByRole('cell', { name: 'loaded once', exact: true }),
    ).toBeVisible();
  }
});

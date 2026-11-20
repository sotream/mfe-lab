import { expect, test } from '@playwright/test';

test('E-frame-swap: dashboard frame renders the dashboard after the products route', async ({
  page,
}) => {
  await page.goto('http://localhost:3000/login');
  await page.getByLabel('Email').fill('editor@lab.test');
  await page.getByLabel('Password').fill('lab12345');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('editor@lab.test', { exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/); // login's replace-navigation has landed

  const nav = page.getByRole('navigation');
  const products = page.locator('section[data-remote="products"]');
  const dashboard = page.locator('section[data-remote="dashboard"]');

  for (let i = 0; i < 2; i++) {
    await nav.getByRole('link', { name: 'Products' }).click();
    await expect(products.getByRole('searchbox', { name: 'Search' })).toBeVisible();

    await nav.getByRole('link', { name: 'Dashboard' }).click();
    for (const label of ['Products', 'Orders', 'Revenue', 'Paid revenue']) {
      await expect(dashboard.locator('dl dt', { hasText: new RegExp(`^${label}$`) })).toBeVisible();
    }
    await expect(dashboard.getByRole('button', { name: 'Add product' })).toHaveCount(0);
    await expect(dashboard.getByRole('searchbox', { name: 'Search' })).toHaveCount(0);
  }
});

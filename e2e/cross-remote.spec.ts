import { expect, test } from '@playwright/test';

const BASE = 'http://localhost:3000';

test('E-cross-remote: adding and deleting a product updates the dashboard tile without reload', async ({
  page,
}) => {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill('editor@lab.test');
  await page.getByLabel('Password').fill('lab12345');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('editor@lab.test', { exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/); // login's replace-navigation has landed

  const products = page.locator('section[data-remote="products"]');
  const dashboard = page.locator('section[data-remote="dashboard"]');
  const tile = dashboard
    .locator('dt', { hasText: /^Products$/ })
    .locator('xpath=following-sibling::dd[1]');
  await expect(tile).toHaveText(/^\d+$/);
  const n = Number(await tile.textContent());

  const sku = `E2E-${Date.now()}`;
  try {
    await products.getByRole('button', { name: 'Add product' }).click();
    const form = products.getByRole('dialog');
    await form.getByLabel('SKU').fill(sku);
    await form.getByLabel('Name').fill(`Cross remote ${sku}`);
    await form.getByLabel('Price').fill('1.00');
    await form.getByLabel('Stock').fill('1');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(tile).toHaveText(String(n + 1));
  } finally {
    // Find the new row through search, so it is on the page whatever the sort.
    await products.getByRole('searchbox', { name: 'Search' }).fill(sku);
    await products.getByRole('button', { name: `Delete ${sku}` }).click();
    await products.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(tile).toHaveText(String(n));
  }
});

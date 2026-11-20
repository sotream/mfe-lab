import { expect, test, type Page } from '@playwright/test';

const BASE = 'http://localhost:3000';

const table = (page: Page) =>
  page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Kind' }) });

// Token lives in memory: after login, move only via nav links.
async function openInspector(page: Page) {
  await page.getByRole('link', { name: 'Inspector' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Errors' })).toBeVisible();
}
async function clearErrors(page: Page) {
  // Wait for the mount fetch to land, or it can overwrite the cleared table.
  await expect(table(page).getByRole('row').nth(1)).toBeVisible();
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByRole('cell', { name: 'No errors' })).toBeVisible();
  await expect(table(page).getByRole('cell', { name: 'products' })).toHaveCount(0);
}

test('E-errors: a crashing products remote is isolated and reported', async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill('admin@lab.test');
  await page.getByLabel('Password').fill('lab12345');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('admin@lab.test', { exact: true })).toBeVisible();

  try {
    await openInspector(page);
    await clearErrors(page);
    const crash = page.getByRole('checkbox', { name: 'products.crash' });
    await expect(crash).toBeEnabled();
    if (!(await crash.isChecked())) await crash.click();
    await expect(crash).toBeChecked({ checked: true });

    await page.getByRole('link', { name: 'Home' }).click();
    await expect(
      page.locator('section[data-remote="products"]').getByText(/products is unavailable/),
    ).toBeVisible();
    await expect(page.locator('section[data-remote="dashboard"]')).toContainText(':3002');
    await expect(
      page.locator('section[data-remote="dashboard"]').getByRole('figure').first(),
    ).toBeVisible();

    await openInspector(page);
    // The report is async (beacon): poll Refresh until the row shows.
    await expect(async () => {
      await page.getByRole('button', { name: 'Refresh' }).click();
      const r = table(page)
        .getByRole('row')
        .filter({ hasText: 'products' })
        .filter({ hasText: 'render' });
      await expect(r.first()).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
  } finally {
    // Best effort, via nav links only.
    await page.getByRole('link', { name: 'Inspector' }).click();
    const crash = page.getByRole('checkbox', { name: 'products.crash' });
    await crash.waitFor({ timeout: 5000 }).catch(() => {});
    if (await crash.isVisible()) {
      if (await crash.isChecked()) await crash.click();
      await expect(crash).toBeChecked({ checked: false });
    }
    const clear = page.getByRole('button', { name: 'Clear' });
    if (await clear.isVisible()) await clear.click();
  }
});

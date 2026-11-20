import { expect, test, type Page } from '@playwright/test';

const BASE = 'http://localhost:3000';
const revenue = (page: Page) =>
  page.locator('section[data-remote="dashboard"]').getByRole('heading', {
    name: 'Revenue by status',
  });

// Token lives in memory: after login, move only via nav links.
async function setRevenue(page: Page, on: boolean): Promise<void> {
  await page.getByRole('link', { name: 'Inspector' }).click();
  const box = page.getByRole('checkbox', { name: 'dashboard.revenue' });
  await expect(box).toBeEnabled();
  if ((await box.isChecked()) !== on) await box.click();
  await expect(box).toBeChecked({ checked: on });
  await page.getByRole('link', { name: 'Home' }).click();
}

test('E-flags: admin toggles dashboard.revenue from the inspector', async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill('admin@lab.test');
  await page.getByLabel('Password').fill('lab12345');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('admin@lab.test', { exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/); // login's replace-navigation has landed

  try {
    await expect(revenue(page)).toBeVisible();
    await setRevenue(page, false);
    await expect(revenue(page)).toHaveCount(0);
    await setRevenue(page, true);
    await expect(revenue(page)).toBeVisible();
  } finally {
    // Leave the flag on for other specs (best effort, via nav links only).
    await page.getByRole('link', { name: 'Inspector' }).click();
    const box = page.getByRole('checkbox', { name: 'dashboard.revenue' });
    if (await box.isVisible()) {
      if (!(await box.isChecked())) await box.click();
      await expect(box).toBeChecked();
    }
  }
});

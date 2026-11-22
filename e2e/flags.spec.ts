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

// Cleanup goes through the API, so a failed test cannot leave state behind for the next spec.
test.afterEach(async ({ request }) => {
  const login = await request.post(`${BASE}/api/auth/login`, {
    data: { email: 'admin@lab.test', password: 'lab12345' },
  });
  const headers = { authorization: `Bearer ${((await login.json()) as { token: string }).token}` };
  await request.patch(`${BASE}/api/flags/dashboard.revenue`, {
    data: { enabled: true },
    headers,
  });
});

test('E-flags: admin toggles dashboard.revenue from the inspector', async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill('admin@lab.test');
  await page.getByLabel('Password').fill('lab12345');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('admin@lab.test', { exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/); // login's replace-navigation has landed

  await expect(revenue(page)).toBeVisible();
  await setRevenue(page, false);
  await expect(revenue(page)).toHaveCount(0);
  await setRevenue(page, true);
  await expect(revenue(page)).toBeVisible();
});

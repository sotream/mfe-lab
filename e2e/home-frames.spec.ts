// T59: a frame sizes to its own content; opening the dashboard's data table must not stretch the products frame.
import { expect, test } from '@playwright/test';

test('home frames do not stretch to each other', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@lab.test');
  await page.getByLabel('Password').fill('lab12345');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('admin@lab.test', { exact: true })).toBeVisible();

  const products = page.locator('section[data-remote="products"]');
  await expect(products.locator('table:not([aria-busy="true"]) tbody tr').first()).toBeVisible();
  await page.locator('section[data-remote="dashboard"] summary').click();

  const { frame, content } = await products.evaluate((el) => {
    const top = el.getBoundingClientRect().top;
    const body = el.querySelector('.remote-frame-body')!.getBoundingClientRect();
    return { frame: el.getBoundingClientRect().height, content: body.bottom - top };
  });
  expect(frame).toBeLessThanOrEqual(content + 2);
});

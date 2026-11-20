import { expect, test } from '@playwright/test';

const BASE = 'http://localhost:3000';

test('E-nested-route: list -> detail -> back, then cold deep link via login', async ({ page }) => {
  const signIn = async () => {
    await page.getByLabel('Email').fill('viewer@lab.test');
    await page.getByLabel('Password').fill('lab12345');
    await page.getByRole('button', { name: 'Sign in' }).click();
  };
  await page.goto(`${BASE}/login`);
  await signIn();
  await expect(page.getByText('viewer@lab.test · ')).toBeVisible();

  await page.getByRole('navigation').getByRole('link', { name: 'Products' }).click();
  const products = page.locator('section[data-remote="products"]');
  await products.locator('tbody tr').first().getByRole('link').first().click();
  await expect(page).toHaveURL(/\/products\/\d+$/);
  await expect(products.getByRole('heading', { level: 2 })).toBeVisible();
  const deep = page.url();
  const id = deep.split('/').at(-1);

  await page.goBack();
  await expect(products.getByRole('table')).toBeVisible();

  await page.goto(deep);
  await expect(page).toHaveURL(/\/login\?next=/);
  expect(new URL(page.url()).searchParams.get('next')).toBe(`/products/${id}`);
  await signIn();
  await expect(page).toHaveURL(deep);
  await expect(products.getByRole('heading', { level: 2 })).toBeVisible();
});

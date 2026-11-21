import { expect, test } from '@playwright/test';

test('E-inspector-layout: even chips, no last-row borders, spaced list', async ({ page }) => {
  // Deterministic chips: two remotes with errors, whatever the API holds.
  await page.route('**/errors/summary', (r) =>
    r.fulfill({
      json: [
        { remote: 'dashboard', count: 3 },
        { remote: 'products', count: 5 },
      ],
    }),
  );
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@lab.test');
  await page.getByLabel('Password').fill('lab12345');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'One page, three independent apps' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Inspector' }).click();

  const chips = page.locator('ul.chips > li');
  await expect(chips).toHaveCount(2);
  const heights = await chips.evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect().height),
  );
  expect(heights[1]).toBe(heights[0]);

  // Remotes, Shared, Flags and Errors tables must all be populated before checking last rows.
  await expect(page.getByRole('checkbox', { name: 'products.crash' })).toBeVisible();
  const tables = page.locator('.panel table');
  expect(await tables.count()).toBeGreaterThanOrEqual(4);
  const borders = await tables.evaluateAll((ts) =>
    ts.flatMap((t) => {
      const rows = t.querySelectorAll('tbody tr');
      return [...rows[rows.length - 1]!.children].map((c) => getComputedStyle(c).borderBottomWidth);
    }),
  );
  expect(borders.length).toBeGreaterThan(10);
  expect(borders.every((b) => b === '0px')).toBe(true);

  const second = page.locator('ol.panel-body > li').nth(1);
  const mt = await second.evaluate((e) => parseFloat(getComputedStyle(e).marginTop));
  expect(mt).toBeGreaterThan(0);
});

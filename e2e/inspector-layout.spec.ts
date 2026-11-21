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

for (const width of [1440, 1280]) {
  test(`E-frame-header: build stamp shares the label row at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/login');
    await page.getByLabel('Email').fill('admin@lab.test');
    await page.getByLabel('Password').fill('lab12345');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'One page, three independent apps' }),
    ).toBeVisible();
    for (const name of ['products', 'dashboard']) {
      await expect(
        page.locator(`section[data-remote="${name}"] .remote-frame-build`),
      ).toBeVisible();
    }
    // Production-length header text (short host, compact stamp).
    const host = 'mfe-lab-dashboard';
    const stamp = 'build 21.11 19:39Z';
    await page.evaluate(
      ([h, s]) => {
        for (const sec of document.querySelectorAll('section[data-remote]')) {
          const port = sec.querySelector('.remote-frame-port');
          const build = sec.querySelector('.remote-frame-build');
          if (port) port.textContent = h!;
          if (build) build.textContent = s!;
        }
      },
      [host, stamp],
    );
    for (const name of ['products', 'dashboard']) {
      const sec = page.locator(`section[data-remote="${name}"]`);
      const top = (sel: string) => sec.locator(sel).evaluate((e) => (e as HTMLElement).offsetTop);
      expect(await top('.remote-frame-build'), name).toBe(await top('.remote-frame-label'));
    }
  });
}

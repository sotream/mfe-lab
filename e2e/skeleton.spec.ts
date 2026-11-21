// T37: Q-reduced-motion, E-no-jump, E-a11y (loading). ASSUMPTIONS (phase 2 adapts): a loading table has
// aria-busy="true"; the shell frame fallback and the remotes' skeletons use `.ds1-skeleton` in the light DOM
// (products and dashboard); the orders table is in a shadow root and Playwright pierces it.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const BASE = 'http://localhost:3000';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const nav = (page: Page) => page.getByRole('navigation');
const frame = (page: Page, name: string) => page.locator(`section[data-remote="${name}"]`);
const busyTable = (page: Page, name: string) =>
  frame(page, name).locator('table[aria-busy="true"]').first();
const loadedRow = (page: Page, name: string) =>
  frame(page, name).locator('table:not([aria-busy="true"]) tbody tr').first();

async function holdApi(page: Page, hold: () => Promise<void>) {
  for (const glob of ['**/api/products?*', '**/api/stats*', '**/api/orders*'])
    await page.route(glob, async (route) => {
      await hold();
      await route.continue();
    });
}

// Gate: held until open() is called, so the skeleton state is stable for as long as a test needs it.
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return { open, wait: () => opened };
}

async function signIn(page: Page) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill('admin@lab.test');
  await page.getByLabel('Password').fill('lab12345');
  await page.getByRole('button', { name: 'Sign in' }).click();
}
async function signedIn(page: Page) {
  await expect(page.getByText('admin@lab.test', { exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);
}

const animationName = (page: Page, name: string, cls: string) =>
  frame(page, name)
    .locator(cls)
    .first()
    .evaluate((el) => getComputedStyle(el).animationName);

test.describe('Q-reduced-motion', () => {
  for (const [reducedMotion, expected] of [
    ['reduce', 'none'],
    ['no-preference', 'not-none'],
  ] as const)
    test(`Q-reduced-motion: ${reducedMotion} gives animation-name ${expected}`, async ({
      page,
    }) => {
      const g = gate();
      await page.emulateMedia({ reducedMotion });
      await holdApi(page, g.wait);
      try {
        await signIn(page);
        await signedIn(page);
        await expect(frame(page, 'products').locator('.ds1-skeleton').first()).toBeVisible();
        // orders is a Vue remote in a shadow root with its own skeleton class
        const check = (n: string) =>
          expected === 'none' ? expect(n).toBe('none') : expect(n).not.toBe('none');
        check(await animationName(page, 'products', '.ds1-skeleton'));
        await nav(page).getByRole('link', { name: 'Orders', exact: true }).click();
        await expect(frame(page, 'orders').locator('.orders-skeleton').first()).toBeVisible();
        check(await animationName(page, 'orders', '.orders-skeleton'));
      } finally {
        g.open();
      }
    });
});

test.describe('E-no-jump', () => {
  test.use({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });

  const height = async (page: Page, where: ReturnType<Page['locator']>) => {
    const box = await where.boundingBox();
    expect(box, 'element has a box').not.toBeNull();
    return box!.height;
  };
  const cls = (page: Page) => page.evaluate(() => (window as never as { __cls: number }).__cls);
  const resetCls = (page: Page) =>
    page.evaluate(() => void ((window as never as { __cls: number }).__cls = 0));

  test('E-no-jump: frames and tables keep their height and layout-shift stays under 0.01', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as never as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as {
          value: number;
          hadRecentInput: boolean;
        }[])
          if (!e.hadRecentInput) (window as never as { __cls: number }).__cls += e.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    // Both holds are gates released only after the loading state was sampled, so a slow or cold
    // runner cannot make the busy state disappear before it is measured.
    let api = gate();
    await holdApi(page, () => api.wait());
    const entry = gate();
    await page.route('http://localhost:3001/mf-manifest.json', async (route) => {
      await entry.wait();
      await route.continue();
    });

    await signIn(page);
    await resetCls(page);
    await signedIn(page);

    // Home. 1) the remote entry is held: both frames show their fallback.
    const names = ['products', 'dashboard'] as const;
    await Promise.all(names.map((n) => expect(frame(page, n)).toBeVisible()));
    const before = {
      products: await height(page, frame(page, 'products')),
      dashboard: await height(page, frame(page, 'dashboard')),
    };
    // 2) the entry is released, the data is still held: busy table.
    entry.open();
    await expect(busyTable(page, 'products')).toBeVisible();
    const tableBusy = await height(page, busyTable(page, 'products'));
    const dashBusy = await height(page, frame(page, 'dashboard'));
    // 3) the data lands.
    api.open();
    await expect(loadedRow(page, 'products')).toBeVisible();
    await expect(frame(page, 'dashboard').locator('svg[role="img"]')).toBeVisible();
    const tableLoaded = await height(page, frame(page, 'products').locator('table'));
    expect(Math.abs(tableLoaded - tableBusy), 'products table').toBeLessThanOrEqual(4);
    for (const n of names) {
      const after = await height(page, frame(page, n));
      expect(Math.abs(after - before[n]), `home ${n} frame`).toBeLessThanOrEqual(4);
    }
    expect(
      Math.abs((await height(page, frame(page, 'dashboard'))) - dashBusy),
      'dashboard busy',
    ).toBeLessThanOrEqual(4);
    await page.waitForTimeout(500);
    expect(await cls(page), 'CLS home').toBeLessThan(0.01);

    // /products: the list is requested again and held.
    api = gate();
    await resetCls(page);
    await nav(page).getByRole('link', { name: 'Products' }).click();
    await expect(page).toHaveURL(/\/products$/);
    const pBody = frame(page, 'products');
    // the home frame is still in the page until the route swaps it: sample only once the table is busy
    await expect(busyTable(page, 'products')).toBeVisible();
    const pBefore = await height(page, pBody);
    const pTableBusy = await height(page, busyTable(page, 'products'));
    api.open();
    await expect(loadedRow(page, 'products')).toBeVisible();
    const pTable = await height(page, pBody.locator('table'));
    expect(Math.abs(pTable - pTableBusy), '/products table').toBeLessThanOrEqual(4);
    expect(Math.abs((await height(page, pBody)) - pBefore), '/products frame').toBeLessThanOrEqual(
      4,
    );
    await page.waitForTimeout(500);
    expect(await cls(page), 'CLS /products').toBeLessThan(0.01);

    // /orders: first visit, so the orders remote itself loads too.
    api = gate();
    await resetCls(page);
    await nav(page).getByRole('link', { name: 'Orders', exact: true }).click();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(frame(page, 'orders')).toBeVisible();
    const oBefore = await height(page, frame(page, 'orders'));
    await expect(busyTable(page, 'orders')).toBeVisible();
    const oTableBusy = await height(page, busyTable(page, 'orders'));
    api.open();
    await expect(loadedRow(page, 'orders')).toBeVisible();
    const oTable = await height(page, frame(page, 'orders').locator('table'));
    expect(Math.abs(oTable - oTableBusy), '/orders table').toBeLessThanOrEqual(4);
    expect(
      Math.abs((await height(page, frame(page, 'orders'))) - oBefore),
      '/orders frame',
    ).toBeLessThanOrEqual(4);
    await page.waitForTimeout(500);
    expect(await cls(page), 'CLS /orders').toBeLessThan(0.01);
  });
});

test.describe('E-a11y loading', () => {
  test.use({ locale: 'en-US' });

  test('E-a11y: axe is clean while the API is held and after it answers', async ({ page }) => {
    const problems: string[] = [];
    const scan = async (where: string) => {
      const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      for (const v of violations.filter((x) => x.impact === 'serious' || x.impact === 'critical'))
        problems.push(
          `${where}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
        );
    };
    const g = gate();
    await holdApi(page, g.wait);
    try {
      await signIn(page);
      await signedIn(page);
      await expect(busyTable(page, 'products')).toBeVisible();
      await scan('home (loading)');

      await nav(page).getByRole('link', { name: 'Products' }).click();
      await expect(busyTable(page, 'products')).toBeVisible();
      await scan('/products (loading)');

      await nav(page).getByRole('link', { name: 'Orders', exact: true }).click();
      await expect(busyTable(page, 'orders')).toBeVisible();
      await scan('/orders (loading)');
    } finally {
      g.open();
    }
    await expect(loadedRow(page, 'orders')).toBeVisible();
    await scan('/orders (loaded)');
    await nav(page).getByRole('link', { name: 'Products' }).click();
    await expect(loadedRow(page, 'products')).toBeVisible();
    await scan('/products (loaded)');

    expect(problems, `axe violations:\n${problems.join('\n')}`).toEqual([]);
  });
});

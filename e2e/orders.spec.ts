// E-orders and E-css-leak. Playwright locators pierce open shadow roots, so `frame.getByRole(...)` finds the Vue table.
import { expect, test, type Page } from '@playwright/test';

const BASE = 'http://localhost:3000';

async function login(page: Page): Promise<void> {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill('admin@lab.test');
  await page.getByLabel('Password').fill('lab12345');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('admin@lab.test', { exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/); // login's replace-navigation has landed
}
const nav = (page: Page) => page.getByRole('navigation');
const orders = (page: Page) => page.locator('section[data-remote="orders"]');
const products = (page: Page) => page.locator('section[data-remote="products"]');

async function openOrders(page: Page) {
  await nav(page).getByRole('link', { name: 'Orders', exact: true }).click();
  await expect(page).toHaveURL(/\/orders$/);
  await expect(orders(page).getByRole('table')).toBeVisible();
  await expect(orders(page).locator('tbody tr').first()).toBeVisible();
}

test('E-orders: rows render inside the frame shadow root, the frame says :3003', async ({
  page,
}) => {
  await login(page);
  await openOrders(page);
  await expect(orders(page).locator('.remote-frame-port')).toHaveText(':3003');
  // the table is not in the light DOM
  await expect(orders(page).locator('table')).toHaveCount(1);
  const inShadow = await orders(page).evaluate((section) => {
    const hosts = [section, ...section.querySelectorAll('*')];
    const host = hosts.find((h) => h.shadowRoot);
    return {
      shadow: Boolean(host?.shadowRoot?.querySelector('table')),
      light: section.querySelector(':scope table') !== null,
    };
  });
  expect(inShadow.shadow).toBe(true);
  expect(inShadow.light).toBe(false);
  await expect(orders(page).getByRole('rowheader').first()).toBeVisible();
  await expect(orders(page).locator('tbody time[datetime]').first()).toBeVisible();
});

test('E-orders: the status filter narrows the rows', async ({ page }) => {
  await login(page);
  await openOrders(page);
  // T38: custom select inside the shadow root (role=combobox / role=option)
  const statuses = orders(page).getByRole('combobox');
  const choose = async (name: RegExp) => {
    await statuses.click();
    await orders(page).getByRole('option', { name }).click();
  };
  await choose(/^(shipped|versendet)$/i);
  await expect
    .poll(async () => {
      const cells = await orders(page).locator('tbody tr').allInnerTexts();
      return cells.length > 0 && cells.every((c) => /shipped|versendet/i.test(c));
    })
    .toBe(true);
  await choose(/^(new|neu)$/i);
  await expect
    .poll(async () => {
      const cells = await orders(page).locator('tbody tr').allInnerTexts();
      return (
        cells.length > 0 &&
        cells.every((c) => /\bnew\b|neu/i.test(c)) &&
        !cells.some((c) => /shipped/i.test(c))
      );
    })
    .toBe(true);
});

test('E-orders: DE/EN relabels the table in place, without a remount', async ({ page }) => {
  await login(page);
  await openOrders(page);
  const caption = orders(page).locator('caption');
  const en = await caption.innerText();
  // Mark the live nodes: a remount would drop the marks.
  await orders(page).evaluate((section) => {
    const all = [section, ...section.querySelectorAll('*')];
    const root = all.find((n) => n.shadowRoot)!.shadowRoot!;
    (root.querySelector('table') as HTMLElement & { __kept?: boolean }).__kept = true;
    (all.find((n) => n.shadowRoot) as HTMLElement & { __kept?: boolean }).__kept = true;
  });
  await page.getByRole('button', { name: 'DE', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(caption).not.toHaveText(en);
  await expect(
    orders(page)
      .getByRole('columnheader', { name: /Menge|Status/ })
      .first(),
  ).toBeVisible();
  const kept = await orders(page).evaluate((section) => {
    const all = [section, ...section.querySelectorAll('*')];
    const host = all.find((n) => n.shadowRoot) as (HTMLElement & { __kept?: boolean }) | undefined;
    const table = host?.shadowRoot?.querySelector('table') as
      (HTMLElement & { __kept?: boolean }) | null | undefined;
    return { host: host?.__kept === true, table: table?.__kept === true };
  });
  expect(kept).toEqual({ host: true, table: true });
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(caption).toHaveText(en);
});

const HOSTILE = 'table, th, td { border: 7px solid rgb(255, 0, 0) !important }';
// Layout and visual properties a leaking stylesheet would change (not all ~500 computed ones).
const PROPS = [
  'display',
  'margin-top',
  'margin-bottom',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-top-style',
  'border-top-color',
  'border-bottom-width',
  'border-bottom-color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'color',
  'background-color',
  'text-align',
  'vertical-align',
];

// Products re-renders when its data arrives, so a node can be replaced between resolving the locator
// and reading it: a detached element has an empty computed style. Retry until the read is from a live node.
async function snap(loc: ReturnType<Page['locator']>): Promise<Record<string, string>> {
  let out: Record<string, string> = {};
  await expect(async () => {
    out = await loc.first().evaluate((el, props) => {
      if (!el.isConnected) throw new Error('detached');
      const s = getComputedStyle(el);
      return Object.fromEntries(props.map((p) => [p, s.getPropertyValue(p)]));
    }, PROPS);
    expect(out['font-size'], 'computed style is not empty').toBeTruthy();
  }).toPass({ timeout: 10_000 });
  return out;
}
const border = async (loc: ReturnType<Page['locator']>) => {
  const s = await snap(loc);
  return `${s['border-top-width']} ${s['border-top-color']}`;
};

// Rows are visible and the network is idle (no refetch re-render pending).
async function settled(rows: ReturnType<Page['locator']>) {
  await expect(rows.first()).toBeVisible();
  await rows.page().waitForLoadState('networkidle'); // no refetch left to re-render the rows
  await expect(rows.first()).toBeVisible();
}

test('E-css-leak: a hostile global style hits products cells but not the orders shadow DOM', async ({
  page,
}) => {
  await login(page);
  await nav(page).getByRole('link', { name: 'Products', exact: true }).click();
  await settled(products(page).locator('tbody tr'));
  await page.addStyleTag({ content: HOSTILE });
  expect(await border(products(page).locator('tbody td'))).toBe('7px rgb(255, 0, 0)');

  await nav(page).getByRole('link', { name: 'Orders', exact: true }).click();
  await settled(orders(page).locator('tbody tr'));
  const own = await border(orders(page).locator('tbody td'));
  expect(own).not.toBe('7px rgb(255, 0, 0)');
  expect(await border(orders(page).locator('thead th'))).not.toBe('7px rgb(255, 0, 0)');
});

test('E-css-leak: visiting orders does not restyle shell or products elements', async ({
  page,
}) => {
  await login(page);
  const probe = async () => {
    await nav(page).getByRole('link', { name: 'Products', exact: true }).click();
    await settled(products(page).locator('tbody tr'));
    return {
      th: await snap(products(page).locator('thead th')),
      td: await snap(products(page).locator('tbody td')),
      nav: await snap(nav(page).getByRole('link')),
      body: await snap(page.locator('body')),
    };
  };
  const sheets = () =>
    page.evaluate(() => document.head.querySelectorAll('style, link[rel="stylesheet"]').length);
  const before = await probe();
  const headBefore = await sheets();
  await openOrders(page);
  const after = await probe();
  expect(Object.keys(before.th).length).toBe(PROPS.length);
  expect(after.th).toEqual(before.th);
  expect(after.td).toEqual(before.td);
  expect(after.nav).toEqual(before.nav);
  expect(after.body).toEqual(before.body);
  // nothing from orders landed in the document
  expect(await sheets()).toBe(headBefore);
});

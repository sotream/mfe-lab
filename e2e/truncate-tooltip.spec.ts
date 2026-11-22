// T39 (on the T41 compact table): E-manifest-fits, E-a11y (tooltip open): Manifest cells use MiddleTruncate with a focusable trigger and role=tooltip.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

const BASE = 'http://localhost:3000';
const API = `${BASE}/api`;
const LONG_CANARY =
  'https://mfe-lab-products-pr-123456789012345678.vercel.app/releases/0.0.2-e2e-with-a-very-long-release-name/mf-manifest.json';
const STABLE = 'http://localhost:3001/mf-manifest.json';

async function setCanary(request: APIRequestContext, canaryUrl: string | null) {
  const login = await request.post(`${API}/auth/login`, {
    data: { email: 'admin@lab.test', password: 'lab12345' },
  });
  const token = ((await login.json()) as { token: string }).token;
  const res = await request.patch(`${API}/registry/products`, {
    data: { canaryUrl, canaryPercent: 0, disabled: false },
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.status(), await res.text()).toBe(200);
}
// Default state: no canary. Tests that need a long canary URL set it themselves.
test.afterEach(async ({ request }) => setCanary(request, null));

async function openInspector(page: Page, who: 'admin' | 'viewer') {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill(`${who}@lab.test`);
  await page.getByLabel('Password').fill('lab12345');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByRole('banner').getByText(`${who}@lab.test`, { exact: true }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);
  await page.getByRole('navigation').getByRole('link', { name: 'Inspector' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Federation inspector' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Details for products' })).toBeVisible();
}

const table = (page: Page) => page.locator('table.remotes');
const header = (page: Page, name: RegExp) => table(page).getByRole('columnheader', { name });
const manifestCell = (page: Page) => table(page).locator('tbody tr').first().locator('td').first();
const inViewport = async (page: Page, el: Locator) => {
  const box = (await el.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
};

for (const who of ['admin', 'viewer'] as const) {
  test(`E-manifest-fits: ${who} at 1440, no horizontal scroll, one-line headers, ellipsis and tooltip`, async ({
    page,
  }) => {
    await openInspector(page, who);

    // no horizontal scrollbar: the table fits the panel
    const fits = await table(page).evaluate((t) => {
      const box = t.closest('.panel, .table-scroll, [class*="scroll"]') ?? t.parentElement!;
      return {
        table: t.scrollWidth,
        scroller: (t.parentElement as HTMLElement).scrollWidth,
        box: box.clientWidth,
        parent: (t.parentElement as HTMLElement).clientWidth,
      };
    });
    expect(fits.scroller).toBeLessThanOrEqual(fits.parent);
    expect(fits.table).toBeLessThanOrEqual(fits.box);

    // headers on one line: same height as the single-line "Remote" header
    const h = (re: RegExp) => header(page, re).evaluate((e) => e.getBoundingClientRect().height);
    const one = await h(/^Remote/);
    for (const re of [/^Manifest/, /^Build/, /^Use/, /^Rollout/]) {
      expect(await h(re), String(re)).toBeLessThanOrEqual(one + 1);
    }

    // the stable URL: force a narrow slot (dev URLs are short), then it must truncate in the middle
    const cell = manifestCell(page);
    const pieces = cell.locator('[aria-hidden="true"]');
    await expect(pieces).toHaveCount(2);
    await pieces
      .first()
      .evaluate((e) => ((e.parentElement as HTMLElement).style.maxWidth = '24ch'));
    expect(await pieces.first().evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
    expect(await pieces.nth(1).textContent()).toMatch(/\/mf-manifest\.json$/);
    expect(await pieces.first().evaluate((e) => getComputedStyle(e).textOverflow)).toBe('ellipsis');

    // hover shows the full URL, fully inside the viewport
    const trigger = cell.locator('[tabindex="0"]').first();
    await trigger.hover();
    const tip = page.getByRole('tooltip');
    await expect(tip).toHaveText(STABLE);
    await inViewport(page, tip);
    await page.mouse.move(0, 0);
    await expect(tip).toHaveCount(0);

    // keyboard: focus shows it, Escape hides it and keeps focus
    await trigger.focus();
    await expect(tip).toHaveText(STABLE);
    await inViewport(page, tip);
    await page.keyboard.press('Escape');
    await expect(tip).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}

// T58: a canary no longer adds a second URL line; the Manifest cell keeps only the stable URL plus a "+ canary" chip,
// and the full canary URL is in the Details dialog.
test('E-manifest-fits: a canary adds only a chip to the Manifest cell, the full URL is in Details', async ({
  page,
  request,
}) => {
  await setCanary(request, LONG_CANARY);
  await openInspector(page, 'viewer');
  const cell = manifestCell(page);
  await expect(cell.locator('[tabindex="0"]')).toHaveCount(1); // the stable URL only
  await expect(cell).toContainText(/\+\s*canary/);
  expect(await cell.evaluate((e) => (e as HTMLElement).textContent)).not.toContain(LONG_CANARY);
  await page.getByRole('button', { name: 'Details for products' }).click();
  await expect(
    page.getByRole('dialog', { name: 'products: details' }).getByText(LONG_CANARY),
  ).toBeVisible();
});

test('E-tooltip-hints: the Manifest and Rollout header hints open on keyboard focus', async ({
  page,
}) => {
  await openInspector(page, 'admin');
  const sentences: Array<[RegExp, string]> = [
    [
      /^Manifest/,
      'Stable: built into the shell at deploy time, everyone loads it. Canary: optional alternative from the registry, served to a share of signed-in users.',
    ],
    [
      /^Rollout/,
      'Share of signed-in users (sticky by user) who get the canary, or "off" when the remote is switched off.',
    ],
  ];
  for (const [name, sentence] of sentences) {
    const hint = header(page, name).locator('button, [tabindex="0"]').first();
    await hint.focus();
    await expect(page.getByRole('tooltip')).toHaveText(sentence);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  }
});

test('E-a11y: axe finds no serious or critical violations on /inspector with a tooltip open', async ({
  page,
}) => {
  await openInspector(page, 'admin');
  const scan = async () => {
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    return violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  };
  expect(await scan()).toEqual([]);

  await manifestCell(page).locator('[tabindex="0"]').first().hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  expect(await scan()).toEqual([]);
});

test('E-manifest-fits: a viewer with a long canary URL still has no horizontal scroll', async ({
  page,
  request,
}) => {
  await setCanary(request, LONG_CANARY);
  await openInspector(page, 'viewer');
  const wrap = table(page).locator('xpath=..');
  expect(await wrap.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
});

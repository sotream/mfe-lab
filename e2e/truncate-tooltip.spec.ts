// T39: E-manifest-fits, E-tooltip-hints, E-a11y (tooltip open). ASSUMPTIONS: the truncated text is a MiddleTruncate with two
// aria-hidden pieces (head, tail) inside the cell; the focusable trigger inside the cell is [tabindex="0"]; the tooltip is
// role=tooltip; the three registry headers carry a focusable hint ([tabindex="0"] or a button) inside the <th>.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

const BASE = 'http://localhost:3000';
const API = `${BASE}/api`;
const LONG_CANARY =
  'https://mfe-lab-products-git-canary-branch-with-a-very-long-name.vercel.app/releases/0.0.2-e2e/mf-manifest.json';
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
  await expect(page.getByText(`${who}@lab.test`, { exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);
  await page.getByRole('navigation').getByRole('link', { name: 'Inspector' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Federation inspector' })).toBeVisible();
  if (who === 'admin') await expect(page.getByLabel('products canary URL')).toBeVisible();
}

const table = (page: Page) =>
  page
    .locator('table')
    .filter({ has: page.getByRole('columnheader', { name: /^Stable manifest/ }) });
const header = (page: Page, name: RegExp) => table(page).getByRole('columnheader', { name });
async function cell(page: Page, name: RegExp): Promise<Locator> {
  const idx = await table(page)
    .locator('thead th')
    .evaluateAll(
      (ths, src) => ths.findIndex((t) => new RegExp(src).test(t.textContent ?? '')),
      name.source,
    );
  expect(idx).toBeGreaterThanOrEqual(0);
  return table(page).locator('tbody tr').first().locator('td, th').nth(idx);
}
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

    // headers on one line: same height as the single-line "Name" header
    const h = (re: RegExp) => header(page, re).evaluate((e) => e.getBoundingClientRect().height);
    const one = await h(/^Name/);
    for (const re of [/^Stable manifest/, /^Canary manifest/, /^Canary %/]) {
      expect(await h(re), String(re)).toBeLessThanOrEqual(one + 1);
    }

    // the Stable manifest cell: force a narrow slot (dev URLs are short), then it must truncate in the middle
    const stable = await cell(page, /^Stable manifest/);
    const pieces = stable.locator('[aria-hidden="true"]');
    await expect(pieces).toHaveCount(2);
    await pieces
      .first()
      .evaluate((e) => ((e.parentElement as HTMLElement).style.maxWidth = '24ch'));
    const trunc = await pieces.first().evaluate((e) => e.scrollWidth > e.clientWidth);
    expect(trunc).toBe(true);
    expect(await pieces.nth(1).textContent()).toMatch(/\/mf-manifest\.json$/);
    expect(await pieces.first().evaluate((e) => getComputedStyle(e).textOverflow)).toBe('ellipsis');

    // hover shows the full URL, fully inside the viewport
    await stable.locator('[tabindex="0"]').first().hover();
    const tip = page.getByRole('tooltip');
    await expect(tip).toHaveText(STABLE);
    await inViewport(page, tip);
    await page.mouse.move(0, 0);
    await expect(tip).toHaveCount(0);

    // keyboard: focus shows it, Escape hides it and keeps focus
    const trigger = stable.locator('[tabindex="0"]').first();
    await trigger.focus();
    await expect(tip).toHaveText(STABLE);
    await inViewport(page, tip);
    await page.keyboard.press('Escape');
    await expect(tip).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}

test('E-manifest-fits: a viewer sees a long Canary manifest truncated in the middle with the full URL in the tooltip', async ({
  page,
  request,
}) => {
  await setCanary(request, LONG_CANARY);
  await openInspector(page, 'viewer');
  const canary = await cell(page, /^Canary manifest/);
  const pieces = canary.locator('[aria-hidden="true"]');
  await expect(pieces).toHaveCount(2);
  expect(await pieces.first().evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  expect(await pieces.nth(1).textContent()).toBe('/mf-manifest.json');
  // copy/select-all gives the whole URL
  expect(await canary.evaluate((e) => (e as HTMLElement).textContent)).toContain(LONG_CANARY);
  await pieces.first().hover();
  await expect(page.getByRole('tooltip')).toHaveText(LONG_CANARY);
});

test('E-tooltip-hints: the header hints open on keyboard focus with the sentence', async ({
  page,
}) => {
  await openInspector(page, 'admin');
  const sentences: Array<[RegExp, string]> = [
    [
      /^Stable manifest/,
      'Built into the shell at deploy time; everyone loads this unless a canary or a pick applies.',
    ],
    [
      /^Canary manifest/,
      'Optional alternative from the registry; served to Canary % of signed-in users.',
    ],
    [/^Canary %/, 'Share of signed-in users (sticky by user) who get the canary.'],
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

  const stable = await cell(page, /^Stable manifest/);
  await stable.locator('[tabindex="0"]').first().hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  expect(await scan()).toEqual([]);
  await page.keyboard.press('Escape');
  await page.mouse.move(0, 0);

  await header(page, /^Canary %/)
    .locator('button, [tabindex="0"]')
    .first()
    .focus();
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

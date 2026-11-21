// T38 custom select: E-select-toplayer, E-select-orders, E-a11y (orders). ASSUMPTION: role=combobox / role=option /
// role=listbox markup; the shell Inspector "Use" select is aria-label "<remote> version"; the orders filter is the only
// combobox inside section[data-remote=orders].
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const BASE = 'http://localhost:3000';
const nav = (page: Page) => page.getByRole('navigation');
const orders = (page: Page) => page.locator('section[data-remote="orders"]');

async function login(page: Page): Promise<void> {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill('admin@lab.test');
  await page.getByLabel('Password').fill('lab12345');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('admin@lab.test', { exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);
}
async function openInspector(page: Page) {
  await nav(page).getByRole('link', { name: 'Inspector' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Federation inspector' })).toBeVisible();
}

// Every option is inside the viewport and is what elementFromPoint finds at its centre: nothing clips or covers it.
async function expectFullyVisible(page: Page) {
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  const res = await page.evaluate(() => {
    const deep = (x: number, y: number) => {
      let el: Element | null = document.elementFromPoint(x, y);
      while (el?.shadowRoot) {
        const inner = el.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === el) break;
        el = inner;
      }
      return el;
    };
    // every select's listbox is always in the DOM (hidden when closed): only the open one counts
    const options = [
      ...document.querySelectorAll('[role="listbox"]:not([hidden]) [role="option"]'),
    ] as HTMLElement[];
    return options.map((o) => {
      const r = o.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const hit = deep(x, y);
      return {
        inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        hit: hit === o || o.contains(hit),
      };
    });
  });
  expect(res.length).toBeGreaterThanOrEqual(2);
  expect(res.every((r) => r.inside)).toBe(true);
  expect(res.every((r) => r.hit)).toBe(true);
}

test.skip(
  process.env.E2E_TARGET === 'docker',
  'nginx serves no releases/ (the Use select needs versions)',
);

for (const size of [
  { width: 1440, height: 900 },
  { width: 390, height: 700 },
]) {
  test(`E-select-toplayer: the popup is not clipped at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await login(page);
    await openInspector(page);
    const use = page.getByRole('combobox', { name: 'products version' });
    await use.scrollIntoViewIfNeeded();
    await use.click();
    await expect(use).toHaveAttribute('aria-expanded', 'true');
    await expectFullyVisible(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toBeHidden();
  });
}

test('E-select-toplayer: near the viewport bottom the popup opens above the trigger', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await login(page);
  await openInspector(page);
  const use = page.getByRole('combobox', { name: 'products version' });
  // size the viewport so the trigger sits about 50 px above its bottom edge (the page may not scroll far enough)
  await use.scrollIntoViewIfNeeded();
  const docY = await use.evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY);
  await page.setViewportSize({ width: 1440, height: Math.ceil(docY + 50) });
  await use.evaluate(() => window.scrollTo(0, 0));
  const trig = await use.boundingBox();
  expect(page.viewportSize()!.height - (trig!.y + trig!.height)).toBeLessThan(80);
  await use.click();
  const box = await page.getByRole('listbox').boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(trig!.y + 1);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  await expectFullyVisible(page);
});

test('E-select-orders: the status filter works with the keyboard only; Escape keeps the value', async ({
  page,
}) => {
  await login(page);
  await nav(page).getByRole('link', { name: 'Orders', exact: true }).click();
  await expect(orders(page).locator('tbody tr').first()).toBeVisible();
  const filter = orders(page).getByRole('combobox');
  const rowsAll = (re: RegExp) => async () => {
    const cells = await orders(page).locator('tbody tr').allInnerTexts();
    return cells.length > 0 && cells.every((c) => re.test(c));
  };

  await filter.focus();
  // APG: the first ArrowDown opens on the selected option (All); then New, then Paid
  await page.keyboard.press('ArrowDown');
  await expect(filter).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(filter).toContainText(/paid|bezahlt/i);
  await expect.poll(rowsAll(/\bpaid\b|bezahlt/i)).toBe(true);

  // Escape closes without changing the value
  await page.keyboard.press('ArrowDown');
  await expect(filter).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(filter).toHaveAttribute('aria-expanded', 'false');
  await expect(filter).toContainText(/paid|bezahlt/i);
  await expect(filter).toBeFocused();
  await expect.poll(rowsAll(/\bpaid\b|bezahlt/i)).toBe(true);
});

test('E-a11y: axe is clean on /orders with the status select open and closed', async ({ page }) => {
  await login(page);
  await nav(page).getByRole('link', { name: 'Orders', exact: true }).click();
  await expect(orders(page).locator('tbody tr').first()).toBeVisible();
  const scan = async () => {
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    return violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  };
  expect(await scan()).toEqual([]);
  const filter = orders(page).getByRole('combobox');
  await filter.click();
  await expect(filter).toHaveAttribute('aria-expanded', 'true');
  await expect(orders(page).getByRole('listbox')).toBeVisible();
  expect(await scan()).toEqual([]);
});

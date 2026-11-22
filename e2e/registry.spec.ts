import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const BASE = 'http://localhost:3000';
const API = `${BASE}/api`;
const REMOTES = ['products', 'dashboard', 'orders'];

const products = (page: Page) => page.locator('section[data-remote="products"]');
const dashboard = (page: Page) => page.locator('section[data-remote="dashboard"]');

async function adminToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API}/auth/login`, {
    data: { email: 'admin@lab.test', password: 'lab12345' },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()).token as string;
}
async function setRegistry(request: APIRequestContext, name: string, patch: object) {
  const token = await adminToken(request);
  const res = await request.patch(`${API}/registry/${name}`, {
    data: patch,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.status(), await res.text()).toBe(200);
}

async function clearErrors(request: APIRequestContext) {
  const token = await adminToken(request);
  await request.delete(`${API}/errors`, { headers: { authorization: `Bearer ${token}` } });
}

// The other specs must not see a canary or a kill switch.
test.afterEach(async ({ request }) => {
  for (const name of REMOTES)
    await setRegistry(request, name, { canaryUrl: null, canaryPercent: 0, disabled: false });
  await clearErrors(request);
});

async function login(page: Page) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill('admin@lab.test');
  await page.getByLabel('Password').fill('lab12345');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('admin@lab.test', { exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/); // login's replace-navigation has landed
}

test('E-kill-switch: a disabled remote is never fetched and shows the off state', async ({
  page,
  request,
}) => {
  await setRegistry(request, 'products', { disabled: true });
  const manifestRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes(':3001/')) manifestRequests.push(r.url());
  });

  await login(page);
  await expect(products(page)).toContainText('products is switched off right now');
  await expect(products(page).getByRole('button', { name: 'Retry' })).toHaveCount(0);
  await expect(dashboard(page).locator('svg[role="img"]')).toBeVisible();

  await page.getByRole('navigation').getByRole('link', { name: 'Products' }).click();
  await expect(products(page)).toContainText('products is switched off right now');
  await expect(products(page).getByRole('button', { name: 'Retry' })).toHaveCount(0);

  // let the idle prefetch run, then check nothing went to the products origin
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => new Promise((done) => requestIdleCallback(done)));
  expect(manifestRequests.filter((u) => /mf-manifest\.json/.test(u))).toEqual([]);
  expect(manifestRequests).toEqual([]);
});

test.describe('canary', () => {
  test.skip(process.env.E2E_TARGET === 'docker', 'nginx serves no releases/');

  async function openInspector(page: Page) {
    await page.getByRole('link', { name: 'Inspector' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Errors' })).toBeVisible();
  }
  // T41: the variant chip is line 2 of the Build cell (second cell; the first is Manifest, whose canary label is
  // also the word "canary"), so match the chip text inside that cell, not the cell name
  const variantCell = (page: Page, text: string) =>
    page
      .getByRole('row', { name: /^products/ })
      .getByRole('cell')
      .nth(1)
      .getByText(text, { exact: true });

  test('E-canary: 100% serves the release, 0% goes back to the default build', async ({
    page,
    request,
  }) => {
    await setRegistry(request, 'products', {
      canaryUrl: 'http://localhost:3001/releases/0.0.2-e2e/mf-manifest.json',
      canaryPercent: 100,
    });
    await login(page);
    await expect(products(page)).toContainText('build 0.0.2-e2e');
    await openInspector(page);
    await expect(variantCell(page, 'canary')).toBeVisible();

    await setRegistry(request, 'products', { canaryPercent: 0 });
    await page.reload();
    await login(page);
    await expect(products(page)).toContainText('build ');
    await expect(products(page)).not.toContainText('e2e');
    await openInspector(page);
    await expect(variantCell(page, 'stable')).toBeVisible();
  });

  test('E-canary-fallback: a broken canary falls back to the default build and reports', async ({
    page,
    request,
  }) => {
    await setRegistry(request, 'products', {
      canaryUrl: 'http://localhost:3001/broken/mf-manifest.json',
      canaryPercent: 100,
    });
    await login(page);
    await expect(products(page)).toContainText('build ');
    await expect(products(page)).not.toContainText('e2e');
    await expect(products(page).locator('tbody tr').first()).toBeVisible();
    await openInspector(page);
    await expect(variantCell(page, 'fell back')).toBeVisible();

    // the report is async (beacon): poll the API
    const token = await adminToken(request);
    await expect
      .poll(async () => {
        const res = await request.get(`${API}/errors`, {
          headers: { authorization: `Bearer ${token}` },
        });
        return JSON.stringify(await res.json());
      })
      .toContain('canary');
  });
});

test('E-a11y: axe on /inspector as admin finds no serious or critical violations', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: 'Inspector' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Errors' })).toBeVisible();
  // T41: the admin controls moved into the details dialog, one button per remote
  for (const name of REMOTES) {
    await expect(page.getByRole('button', { name: `Details for ${name}` })).toBeVisible();
    await expect(page.getByLabel(`${name} canary URL`)).toHaveCount(0); // not inline any more
  }
  await page.getByRole('button', { name: 'Details for products' }).click();
  const dialog = page.getByRole('dialog', { name: 'products: details' });
  await expect(dialog.getByLabel('products canary URL')).toBeVisible();
  await expect(dialog.getByLabel('products canary percent')).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Switch products off' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  const scan = async () => {
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    return violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  };
  expect(await scan()).toEqual([]);
  // T38 E-a11y: the same with a custom select open (the popup is in the top layer)
  const use = page.getByRole('combobox', { name: 'products version' });
  await use.click();
  await expect(use).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('listbox')).toBeVisible();
  expect(await scan()).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(use).toHaveAttribute('aria-expanded', 'false');
});

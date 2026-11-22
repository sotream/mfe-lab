// T41: E-remotes-fit, E-details, E-a11y (details dialog) on `table.remotes`; language switched via the stored locale (mfe-lab:locale).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const BASE = 'http://localhost:3000';
const API = `${BASE}/api`;
const REMOTES = ['products', 'dashboard', 'orders'];
const LONG = (n: string) =>
  `https://mfe-lab-${n}-pr-123456789012345678.vercel.app/releases/0.0.2-e2e-with-a-very-long-release-name/mf-manifest.json`;

async function patchAll(request: APIRequestContext, patch: (n: string) => object) {
  const login = await request.post(`${API}/auth/login`, {
    data: { email: 'admin@lab.test', password: 'lab12345' },
  });
  const token = ((await login.json()) as { token: string }).token;
  for (const n of REMOTES) {
    const res = await request.patch(`${API}/registry/${n}`, {
      data: patch(n),
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status(), await res.text()).toBe(200);
  }
}
test.afterEach(async ({ request }) =>
  patchAll(request, () => ({ canaryUrl: null, canaryPercent: 0, disabled: false })),
);

async function openInspector(page: Page, who: 'admin' | 'viewer', locale: 'en' | 'de' = 'en') {
  await page.addInitScript((l) => localStorage.setItem('mfe-lab:locale', l), locale);
  await page.goto(`${BASE}/login`);
  await page.getByLabel(locale === 'en' ? 'Email' : /E-Mail/).fill(`${who}@lab.test`);
  await page.getByLabel(locale === 'en' ? 'Password' : /Passwort/).fill('lab12345');
  await page.getByRole('button', { name: locale === 'en' ? 'Sign in' : /Anmelden/ }).click();
  await expect(
    page.getByRole('banner').getByText(`${who}@lab.test`, { exact: true }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);
  await page
    .getByRole('navigation')
    .getByRole('link', { name: /Inspector/ })
    .click();
  await expect(page.locator('table.remotes')).toBeVisible();
}
const table = (page: Page) => page.locator('table.remotes');
const rollout = (page: Page, name: string) =>
  table(page)
    .getByRole('row')
    .filter({
      has: page.getByRole('rowheader', {
        name: new RegExp(
          `^${name}\\s*(up|down|checking|off|erreichbar|nicht erreichbar|prüfe|aus)`,
        ),
      }),
    })
    .getByRole('cell')
    .last(); // line 1 is the rollout, line 2 the Details button, so match the start of the text
for (const width of [1024, 1280, 1440]) {
  for (const locale of ['en', 'de'] as const) {
    for (const who of ['admin', 'viewer'] as const) {
      test(`E-remotes-fit: ${who} ${locale} at ${width}, long canary URLs, no horizontal scroll and one-line headers`, async ({
        page,
        request,
      }) => {
        await patchAll(request, (n) => ({
          canaryUrl: LONG(n),
          canaryPercent: 30,
          disabled: false,
        }));
        await page.setViewportSize({ width, height: 900 });
        await openInspector(page, who, locale);
        await expect(rollout(page, 'products')).toHaveText(/^canary 30 ?%/i);
        const m = await table(page).evaluate((t) => {
          const box = t.closest('.panel') ?? t.parentElement!;
          const heads = [...t.querySelectorAll('thead th')].map((th) => {
            const r = document.createRange();
            // the label's own text node: the hint badge next to it may sit a pixel off the baseline
            r.selectNodeContents(th.childNodes[0]!);
            return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
          });
          return {
            table: t.scrollWidth,
            parent: (t.parentElement as HTMLElement).scrollWidth,
            parentClient: (t.parentElement as HTMLElement).clientWidth,
            box: box.clientWidth,
            heads,
          };
        });
        expect(m.table).toBeLessThanOrEqual(m.box);
        expect(m.parent).toBeLessThanOrEqual(m.parentClient);
        expect(m.heads).toHaveLength(5);
        expect(m.heads.every((n) => n === 1)).toBe(true);
      });
    }
  }
}

test('E-details: set canary 30%, then Off; Rollout and the home frame follow', async ({ page }) => {
  // T46: the docker API runs NODE_ENV=production, which rejects localhost canaries with 400.
  test.skip(process.env.E2E_TARGET === 'docker', 'prod API rejects localhost canary URLs');
  await page.setViewportSize({ width: 1440, height: 900 });
  await openInspector(page, 'admin');
  const dialog = page.getByRole('dialog', { name: 'products: details' });

  await page.getByRole('button', { name: 'Details for products' }).click();
  await dialog
    .getByLabel('products canary URL')
    .fill('http://localhost:3001/releases/0.0.2-e2e/mf-manifest.json');
  await dialog.getByLabel('products canary percent').fill('30');
  await dialog.getByRole('button', { name: 'Save products registry' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(rollout(page, 'products')).toHaveText(/^canary 30 ?%/i);

  await page.getByRole('button', { name: 'Details for products' }).click();
  await dialog.getByRole('checkbox', { name: 'Switch products off' }).check();
  await dialog.getByRole('button', { name: 'Save products registry' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(rollout(page, 'products')).toHaveText(/^off/);

  await page.goBack(); // the home page, where the products frame is
  await expect(page.locator('section[data-remote="products"]')).toContainText(
    'products is switched off right now',
  );
});

test.describe('E-a11y: details dialog', () => {
  const scan = async (page: Page) => {
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    return violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  };
  for (const who of ['admin', 'viewer'] as const) {
    test(`axe is clean on /inspector as ${who}, closed and with the dialog open`, async ({
      page,
    }) => {
      await openInspector(page, who);
      expect(await scan(page)).toEqual([]);
      await page.getByRole('button', { name: 'Details for products' }).click();
      await expect(page.getByRole('dialog', { name: 'products: details' })).toBeVisible();
      expect(await scan(page)).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
  }
});

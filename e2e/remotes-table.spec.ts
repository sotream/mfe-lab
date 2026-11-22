// T41 + T58 (compact one-line rows): E-remotes-fit, E-details, E-a11y (details dialog) on `table.remotes`; language switched via the stored locale (mfe-lab:locale).
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
// T58: the row header reads "products, up" (hidden text) or "products down"; cells: Manifest, Build, Use, Rollout, Details
const rowFor = (page: Page, name: string) =>
  table(page)
    .getByRole('row')
    .filter({
      has: page.getByRole('rowheader', {
        name: new RegExp(
          `^${name}[\\s,]*(up|down|checking|off|erreichbar|nicht erreichbar|prüfe|aus)`,
        ),
      }),
    });
const rollout = (page: Page, name: string) => rowFor(page, name).getByRole('cell').nth(3);
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
        expect(m.heads).toHaveLength(6); // T58: the last, Details header is visually hidden
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

// T58 Q-remotes-compact, Select size="sm", E-a11y on the compact rows.
test.describe('T58 compact rows', () => {
  const rowHeights = (page: Page) =>
    table(page)
      .locator('tbody tr')
      .evaluateAll((rows) => rows.map((r) => r.getBoundingClientRect().height));

  for (const who of ['admin', 'viewer'] as const) {
    test(`E-remotes-compact: ${who} rows are one line, equal height, status and chips on the line`, async ({
      page,
      request,
    }) => {
      await patchAll(request, (n) => ({ canaryUrl: LONG(n), canaryPercent: 30, disabled: false }));
      await page.setViewportSize({ width: 1280, height: 900 });
      await openInspector(page, who);
      const heights = await rowHeights(page);
      expect(heights).toHaveLength(3);
      for (const h of heights) {
        expect(Math.abs(h - heights[0]!)).toBeLessThanOrEqual(1);
        expect(h).toBeLessThanOrEqual(56); // about 48 px
      }
      // one line: every td's content is as tall as a single text line plus padding
      const tops = await table(page)
        .locator('tbody tr')
        .first()
        .evaluate((tr) =>
          [...tr.children].map((c) => {
            const kids = [...c.querySelectorAll('*')].filter(
              (e) => e.getBoundingClientRect().height > 1,
            );
            const mid = (e: Element) => {
              const b = e.getBoundingClientRect();
              return b.top + b.height / 2;
            };
            return kids.length ? Math.max(...kids.map(mid)) - Math.min(...kids.map(mid)) : 0;
          }),
        );
      for (const spread of tops) expect(spread).toBeLessThanOrEqual(8); // vertically centred, no second line

      // Build: stamp and variant chip on the same line, no bucket
      const build = rowFor(page, 'products').getByRole('cell').nth(1);
      await expect(build.getByText(/^(stable|canary|fell back)$/)).toBeVisible(); // bucket decides which
      await expect(build).not.toContainText(/bucket/i);
      // Manifest: a small "+ canary" chip, the canary URL is not in the table
      await expect(rowFor(page, 'products').getByRole('cell').first()).toContainText(/\+\s*canary/);
      await expect(table(page)).not.toContainText('releases/0.0.2-e2e-with-a-very-long');
    });
  }

  test('E-remotes-compact: no + canary chip without a canary; up shows no visible word', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openInspector(page, 'viewer');
    await expect(table(page).getByText(/\+\s*canary/)).toHaveCount(0);
    const rh = table(page).getByRole('rowheader').first();
    const word = rh.getByText(/^(,\s*)?up$/); // hidden text, clipped by .visually-hidden
    const box = await word.boundingBox();
    expect(box === null || (box.width <= 2 && box.height <= 2)).toBe(true);
    await expect(rh).toHaveAccessibleName(/products[\s,]*up/);
  });

  test('E-remotes-compact: down and off show the word', async ({ page, request }) => {
    await patchAll(request, (n) => ({
      canaryUrl: null,
      canaryPercent: 0,
      disabled: n === 'orders',
    }));
    await page.setViewportSize({ width: 1280, height: 900 });
    await openInspector(page, 'viewer');
    const word = table(page)
      .getByRole('rowheader', { name: /^orders/ })
      .getByText('off', { exact: true });
    await expect(word).toBeVisible();
    expect((await word.boundingBox())!.width).toBeGreaterThan(8);
  });

  test('E-remotes-compact: Details is a 32px icon button, a row click also opens Details', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openInspector(page, 'viewer');
    const btn = page.getByRole('button', { name: 'Details for products' });
    const box = (await btn.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(32);
    expect(box.height).toBeGreaterThanOrEqual(32);
    await expect(btn).not.toHaveText(/Details/);
    await rowFor(page, 'products').getByRole('cell').nth(1).click();
    await expect(page.getByRole('dialog', { name: 'products: details' })).toBeVisible();
  });

  test('E-select-sm: the Use select in the table is at most 32px tall, the Details dialog selects are unchanged', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openInspector(page, 'viewer');
    const use = page.getByRole('combobox', { name: 'products version' });
    expect((await use.boundingBox())!.height).toBeLessThanOrEqual(32);
    // other Select usages keep the default size: any combobox outside the remotes table is taller
    const others = page.locator('main [role="combobox"]:not(table.remotes *)');
    for (const h of await others.evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect().height),
    ))
      expect(h).toBeGreaterThan(32);
  });

  test('E-a11y: axe is clean on the compact table in DE as admin', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await openInspector(page, 'admin', 'de');
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    ).toEqual([]);
  });
});

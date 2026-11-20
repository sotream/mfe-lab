import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const BASE = 'http://localhost:3000';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const SP = '[\\s\\u00a0\\u202f]'; // Intl uses U+00A0 / U+202F where a space is expected

// The German labels of the login form are not part of the contract, so find the fields by type.
async function login(page: Page, email: string): Promise<void> {
  await page.goto(`${BASE}/login`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill('lab12345');
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/); // login's replace-navigation has landed
}

const products = (page: Page) => page.locator('section[data-remote="products"]');
const nav = (page: Page) => page.getByRole('navigation');
const lang = (page: Page) => page.locator('html');

test.describe('German browser', () => {
  test.use({ locale: 'de-DE' });

  test('E-locale: de-DE gives lang=de, German nav, German prices and dates', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await expect(lang(page)).toHaveAttribute('lang', 'de');
    await expect(page).toHaveTitle('Anmelden – mfe-lab');
    await login(page, 'viewer@lab.test');
    await expect(lang(page)).toHaveAttribute('lang', 'de');

    const n = nav(page);
    for (const name of ['Startseite', 'Produkte', 'Dashboard', 'Inspector'])
      await expect(n.getByRole('link', { name, exact: true })).toBeVisible();
    await expect(page).toHaveTitle('Startseite – mfe-lab');
    await expect(page.getByRole('group', { name: 'Sprache' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Deutsch' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await n.getByRole('link', { name: 'Produkte', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Produkte' })).toBeVisible();
    await expect(page).toHaveTitle('Produkte – mfe-lab');
    const first = products(page).locator('tbody tr').first();
    await expect(first).toBeVisible();
    await expect(first).toContainText(new RegExp(`\\d,\\d{2}${SP}€`));
    await expect(first).toContainText(/\d{2}\.\d{2}\.\d{4}/);
    await expect(products(page).getByRole('link', { name: 'Drucksensor' })).toBeVisible();

    await n.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(page.locator('section[data-remote="dashboard"] svg[role="img"]')).toHaveAttribute(
      'aria-label',
      /^Bestellungen pro Tag, \d{2}\.\d{2}\.\d{4} bis \d{2}\.\d{2}\.\d{4}: \d+ Bestellungen, Spitze \d+ am \d{2}\.\d{2}\.\d{4}$/,
    );
  });

  test('E-locale: a German product detail shows the VAT note', async ({ page }) => {
    await login(page, 'viewer@lab.test');
    await nav(page).getByRole('link', { name: 'Produkte', exact: true }).click();
    await products(page).locator('tbody tr').first().getByRole('link').first().click();
    await expect(page).toHaveURL(/\/products\/\d+$/);
    await expect(products(page).getByRole('heading', { level: 3 })).toBeVisible();
    await expect(products(page)).toContainText(new RegExp(`inkl\\. 19${SP}% MwSt\\.`));
    await expect(products(page)).toContainText(new RegExp(`\\d,\\d{2}${SP}€`));
    await expect(page).toHaveTitle(/ – Produkte – mfe-lab$/);
  });

  test('E-locale: switching to EN is instant and persists across a reload', async ({ page }) => {
    await login(page, 'viewer@lab.test');
    await nav(page).getByRole('link', { name: 'Produkte', exact: true }).click();
    await expect(products(page).locator('tbody tr').first()).toBeVisible();
    await page.evaluate(() => ((window as unknown as { __kept: boolean }).__kept = true));

    await page.getByRole('button', { name: 'English' }).click();
    await expect(lang(page)).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1, name: 'Products' })).toBeVisible();
    await expect(nav(page).getByRole('link', { name: 'Home', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'English' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(products(page).locator('tbody tr').first()).toContainText(/€\d/);
    await expect(products(page).locator('tbody tr').first()).toContainText(/\d{2}\/\d{2}\/\d{4}/);
    await expect(page).toHaveURL(`${BASE}/products`); // route kept
    expect(await page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept)).toBe(
      true,
    ); // no reload
    expect(await page.evaluate(() => localStorage.getItem('mfe-lab:locale'))).toBe('en');

    await page.reload(); // the token is in memory, so this lands on the login page
    await expect(lang(page)).toHaveAttribute('lang', 'en');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Sign in to the shell' }),
    ).toBeVisible();

    await login(page, 'viewer@lab.test');
    await expect(lang(page)).toHaveAttribute('lang', 'en');
    await expect(nav(page).getByRole('link', { name: 'Products', exact: true })).toBeVisible();
  });
});

test('E-locale: an English browser stays English, and DE is one click away', async ({ page }) => {
  await login(page, 'viewer@lab.test');
  await expect(lang(page)).toHaveAttribute('lang', 'en');
  await page.getByRole('button', { name: 'Deutsch' }).click();
  await expect(lang(page)).toHaveAttribute('lang', 'de');
  await expect(nav(page).getByRole('link', { name: 'Produkte', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mfe-lab:locale'))).toBe('de');
});

for (const [name, locale] of [
  ['German', 'de-DE'],
  ['English', 'en-US'],
] as const) {
  test.describe(`${name} legal pages`, () => {
    test.use({ locale });

    test(`E-locale: /impressum and /datenschutz are public and have no serious a11y issues (${locale})`, async ({
      page,
    }) => {
      const problems: string[] = [];
      const de = locale === 'de-DE';
      for (const [path, h1, title] of [
        ['/impressum', de ? 'Impressum' : 'Legal notice', de ? 'Impressum' : 'Legal notice'],
        ['/datenschutz', de ? 'Datenschutz' : 'Privacy', de ? 'Datenschutz' : 'Privacy'],
      ] as const) {
        await page.goto(`${BASE}${path}`);
        await expect(page).toHaveURL(`${BASE}${path}`); // no redirect to /login
        await expect(page.getByRole('heading', { level: 1 })).toContainText(h1);
        await expect(page).toHaveTitle(`${title} – mfe-lab`);
        const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        for (const v of violations.filter((x) => x.impact === 'serious' || x.impact === 'critical'))
          problems.push(
            `${path}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
          );
      }
      expect(problems, `axe violations:\n${problems.join('\n')}`).toEqual([]);
    });

    test(`E-locale: the footer links lead to the legal pages (${locale})`, async ({ page }) => {
      const de = locale === 'de-DE';
      await page.goto(`${BASE}/login`);
      await page
        .locator('footer')
        .getByRole('link', { name: de ? 'Impressum' : 'Legal notice' })
        .click();
      await expect(page).toHaveURL(`${BASE}/impressum`);
      await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
      await expect(page.locator('main address')).toContainText('Musterstraße 1');
      await expect(page.getByRole('link', { name: '+49 30 1234567' })).toHaveAttribute(
        'href',
        'tel:+49301234567',
      );
      await expect(page.getByRole('link', { name: 'max@mustermann.example' })).toHaveAttribute(
        'href',
        'mailto:max@mustermann.example',
      );
      await page
        .locator('footer')
        .getByRole('link', { name: de ? 'Datenschutz' : 'Privacy' })
        .click();
      await expect(page).toHaveURL(`${BASE}/datenschutz`);
    });
  });
}

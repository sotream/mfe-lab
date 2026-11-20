/** @vitest-environment jsdom */
import { login, logout } from '@mfe/auth-store';
import { emit, onAny, type MfeEvent } from '@mfe/events';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const Stub = () => <h3>remote heading</h3>;
vi.mock('@module-federation/enhanced/runtime', () => ({
  getInstance: () => null,
  init: vi.fn(),
  registerRemotes: vi.fn(),
  loadRemote: vi.fn(() => Promise.resolve({ default: Stub, buildVersion: 'test' })),
}));

import InspectorPage from '../src/InspectorPage.tsx';

const KEY = 'mfe-lab:locale';
const norm = (s: string | null | undefined) =>
  (s ?? '').replace(new RegExp('[\u00a0\u202f]', 'g'), ' ');
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const flags = [
  { name: 'dashboard.revenue', enabled: true, description: 'Revenue' },
  { name: 'products.crash', enabled: false, description: 'Crash demo' },
];
const errorRow = {
  id: 1,
  remote: 'products',
  build: 'b1',
  kind: 'render',
  message: 'kaboom',
  stack: null,
  url: 'http://localhost:3000/',
  at: '2026-11-20T10:00:00.000Z',
};

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = 'en';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/auth/login') {
        const email = JSON.parse(String(init?.body)).email as string;
        return json(200, { token: 't', user: { id: 1, email, role: 'admin' } });
      }
      if (url === '/api/flags' && method === 'GET') return json(200, flags);
      if (url.startsWith('/api/flags/') && method === 'PATCH') {
        const body = JSON.parse(String(init?.body));
        const name = decodeURIComponent(url.slice('/api/flags/'.length));
        return json(200, { ...flags.find((f) => f.name === name), enabled: body.enabled });
      }
      if (url.startsWith('/api/errors/summary'))
        return json(200, [{ remote: 'products', count: 1 }]);
      if (url.startsWith('/api/errors') && method === 'DELETE')
        return new Response(null, { status: 204 });
      if (url.startsWith('/api/errors')) return json(200, [errorRow]);
      return json(200, []);
    }),
  );
});
afterEach(() => {
  cleanup();
  logout();
  localStorage.clear();
  document.documentElement.lang = '';
  vi.unstubAllGlobals();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const load = async () => (await import('../src/App.tsx')).router;
const navigate = async (to: string) => {
  const router = await load();
  await act(async () => {
    await router.navigate(to);
    await sleep(30);
  });
};
const mount = async (path: string, as?: string) => {
  if (as) await act(() => login(`${as}@lab.test`, 'lab12345'));
  window.history.pushState({}, '', path);
  const router = await load();
  await act(async () => {
    await router.navigate(path);
    render(<RouterProvider router={router} />);
    await sleep(30);
  });
};
const h1 = () => screen.getByRole('heading', { level: 1 });
const nav = () => screen.getByRole('navigation');
const navNames = () =>
  within(nav())
    .getAllByRole('link')
    .map((a) => a.textContent);
const setLocale = (locale: 'de' | 'en') =>
  act(async () => {
    document.documentElement.lang = locale;
    emit('locale:changed', { locale });
    await sleep(30);
  });

describe('locale switch', () => {
  it('Q-locale-switch: the group, its buttons and the initial state', async () => {
    await mount('/', 'admin');
    const group = screen.getByRole('group', { name: 'Language' });
    const en = within(group).getByRole('button', { name: 'English' });
    const de = within(group).getByRole('button', { name: 'Deutsch' });
    expect(en.textContent).toBe('EN');
    expect(de.textContent).toBe('DE');
    expect(en.getAttribute('lang')).toBe('en');
    expect(de.getAttribute('lang')).toBe('de');
    expect(en.getAttribute('aria-pressed')).toBe('true');
    expect(de.getAttribute('aria-pressed')).toBe('false');
  });

  it('Q-locale-switch: DE then EN sets lang, aria-pressed, storage and emits locale:changed', async () => {
    await mount('/', 'admin');
    const seen: MfeEvent[] = [];
    const off = onAny((e) => void seen.push(e));
    const group = () => screen.getByRole('group', { name: /^(Language|Sprache)$/ });

    await act(async () => {
      fireEvent.click(within(group()).getByRole('button', { name: 'Deutsch' }));
      await sleep(30);
    });
    expect(document.documentElement.lang).toBe('de');
    expect(localStorage.getItem(KEY)).toBe('de');
    expect(seen.filter((e) => e.name === 'locale:changed').map((e) => e.detail)).toEqual([
      { locale: 'de' },
    ]);
    expect(screen.getByRole('group', { name: 'Sprache' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deutsch' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'English' }).getAttribute('aria-pressed')).toBe(
      'false',
    );

    seen.length = 0;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'English' }));
      await sleep(30);
    });
    off();
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem(KEY)).toBe('en');
    expect(seen.filter((e) => e.name === 'locale:changed').map((e) => e.detail)).toEqual([
      { locale: 'en' },
    ]);
    expect(screen.getByRole('group', { name: 'Language' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'English' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('Q-locale-switch: shell text changes in place; route and focus are kept', async () => {
    await mount('/products', 'admin');
    expect(navNames()).toEqual(['mfe-lab', 'Home', 'Products', 'Dashboard', 'Inspector']);
    const navEl = nav();
    const link = within(navEl).getByRole('link', { name: 'Products' });
    const skip = document.querySelector('.skip-link') as HTMLElement;
    const router = await load();

    const de = screen.getByRole('button', { name: 'Deutsch' });
    de.focus();
    await act(async () => {
      fireEvent.click(de);
      await sleep(30);
    });

    expect(navNames().slice(1)).toEqual(['Startseite', 'Produkte', 'Dashboard', 'Inspector']);
    expect(nav()).toBe(navEl); // no remount
    expect(link.isConnected).toBe(true);
    expect(link.textContent).toBe('Produkte');
    expect(skip.textContent).toBe('Zum Inhalt springen');
    expect(h1().textContent).toBe('Produkte');
    expect(document.title).toBe('Produkte – mfe-lab');
    expect(router.state.location.pathname).toBe('/products');
    expect(window.location.pathname).toBe('/products');
    expect(document.activeElement).toBe(de);
    expect(screen.getByRole('heading', { level: 2, name: 'products' })).toBeTruthy();
  });

  it('Q-locale-switch: a saved choice sets the buttons for the next page', async () => {
    document.documentElement.lang = 'de';
    localStorage.setItem(KEY, 'de');
    await mount('/', 'admin');
    expect(screen.getByRole('button', { name: 'Deutsch' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});

describe('German strings', () => {
  it('Q-de-strings: nav, skip link, h1 and titles per route', async () => {
    document.documentElement.lang = 'de';
    await mount('/', 'admin');
    expect(navNames().slice(1)).toEqual(['Startseite', 'Produkte', 'Dashboard', 'Inspector']);
    const skip = document.querySelector('.skip-link') as HTMLAnchorElement;
    expect(skip.textContent).toBe('Zum Inhalt springen');
    expect(skip.getAttribute('href')).toBe('#main');
    expect(document.title).toBe('Startseite – mfe-lab');

    await navigate('/products');
    expect(document.title).toBe('Produkte – mfe-lab');
    expect(h1().textContent).toBe('Produkte');
    await navigate('/dashboard');
    expect(document.title).toBe('Dashboard – mfe-lab');
    expect(h1().textContent).toBe('Dashboard');
    await navigate('/inspector');
    expect(document.title).toBe('Inspector – mfe-lab');
    expect(document.activeElement).toBe(h1());
  });

  it('Q-de-strings: /login signed out is "Anmelden – mfe-lab"', async () => {
    document.documentElement.lang = 'de';
    await mount('/login');
    expect(document.title).toBe('Anmelden – mfe-lab');
  });

  it('Q-de-strings: footer links are Impressum and Datenschutz', async () => {
    document.documentElement.lang = 'de';
    await mount('/', 'admin');
    const footer = document.querySelector('footer') as HTMLElement;
    expect(within(footer).getByRole('link', { name: 'Impressum' })).toBeTruthy();
    expect(within(footer).getByRole('link', { name: 'Datenschutz' })).toBeTruthy();
  });

  it('Q-de-strings: the footer links are Legal notice and Privacy in EN', async () => {
    await mount('/', 'admin');
    const footer = document.querySelector('footer') as HTMLElement;
    expect(within(footer).getByRole('link', { name: 'Legal notice' })).toBeTruthy();
    expect(within(footer).getByRole('link', { name: 'Privacy' })).toBeTruthy();
  });

  describe('inspector announcements', () => {
    const announced: string[] = [];
    let off: () => void;
    beforeEach(async () => {
      await act(() => login('admin@lab.test', 'lab12345'));
      await act(async () => {
        render(<InspectorPage />);
        await sleep(30);
      });
      announced.length = 0;
      off = onAny((e) => {
        if (e.name === 'a11y:announce') announced.push((e.detail as { message: string }).message);
      });
    });
    afterEach(() => off?.());
    const click = (el: HTMLElement) =>
      act(async () => {
        fireEvent.click(el);
        await sleep(30);
      });

    it('Q-de-strings: flags announce "<flag> eingeschaltet" / "ausgeschaltet"', async () => {
      await setLocale('de');
      await click(screen.getByRole('checkbox', { name: 'products.crash' }));
      expect(announced).toEqual(['products.crash eingeschaltet']);
      announced.length = 0;
      await click(screen.getByRole('checkbox', { name: 'dashboard.revenue' }));
      expect(announced).toEqual(['dashboard.revenue ausgeschaltet']);
    });

    it('Q-de-strings: clearing errors announces "Fehler gelöscht"', async () => {
      // The German label of the button is not part of the contract: take it by its EN name,
      // then switch. The element is the same node, so the click is the same user action.
      const clear = screen.getByRole('button', { name: 'Clear' });
      await setLocale('de');
      await click(clear);
      expect(announced).toEqual(['Fehler gelöscht']);
    });

    it('Q-de-strings: in EN the T26 strings are unchanged', async () => {
      await click(screen.getByRole('checkbox', { name: 'products.crash' }));
      expect(announced).toEqual(['products.crash turned on']);
      announced.length = 0;
      await click(screen.getByRole('button', { name: 'Clear' }));
      expect(announced).toEqual(['Errors cleared']);
    });
  });
});

describe('legal pages', () => {
  const cases = [
    {
      path: '/impressum',
      de: { title: 'Impressum – mfe-lab', h1: 'Impressum' },
      en: { title: 'Legal notice – mfe-lab', h1: 'Legal notice' },
    },
    {
      path: '/datenschutz',
      de: { title: 'Datenschutz – mfe-lab', h1: 'Datenschutz' },
      en: { title: 'Privacy – mfe-lab', h1: 'Privacy' },
    },
  ];

  it('Q-legal: both routes render signed out with one h1 and the title, DE and EN', async () => {
    for (const c of cases) {
      for (const lang of ['de', 'en'] as const) {
        document.documentElement.lang = lang;
        await mount(c.path);
        expect(screen.getAllByRole('heading', { level: 1 }), `${c.path} ${lang}`).toHaveLength(1);
        expect(h1().textContent).toContain(c[lang].h1);
        expect(document.title).toBe(c[lang].title);
        cleanup();
      }
    }
  });

  it('Q-legal: Impressum has the address block, contact links and the placeholder note', async () => {
    document.documentElement.lang = 'de';
    await mount('/impressum');
    const text = norm(document.body.textContent);
    expect(text).toContain('Angaben gemäß § 5 DDG');
    for (const s of ['Max Mustermann', 'Musterstraße 1', '12345 Musterstadt', 'Deutschland'])
      expect(text, s).toContain(s);
    const address = document.querySelector('main address') as HTMLElement;
    expect(address).not.toBeNull();
    expect(norm(address.textContent)).toContain('Musterstraße 1');
    const tel = screen.getByRole('link', { name: '+49 30 1234567' });
    expect(tel.getAttribute('href')).toBe('tel:+49301234567');
    const mail = screen.getByRole('link', { name: 'max@mustermann.example' });
    expect(mail.getAttribute('href')).toBe('mailto:max@mustermann.example');
    expect(text).toContain('Platzhalter: Dies ist ein Lernprojekt, keine echten Kontaktdaten.');
  });

  it('Q-legal: in EN the note is translated and "Impressum" is marked lang=de', async () => {
    await mount('/impressum');
    expect(norm(document.body.textContent)).toContain(
      'Placeholder: this is a learning project, not real contact details.',
    );
    const de = Array.from(document.querySelectorAll('main [lang="de"]')).map((e) =>
      e.textContent?.trim(),
    );
    expect(de).toContain('Impressum');
    expect(document.querySelector('main address')).not.toBeNull();
    expect(screen.getByRole('link', { name: '+49 30 1234567' }).getAttribute('href')).toBe(
      'tel:+49301234567',
    );
  });

  it('Q-legal: Datenschutz says honestly what is stored, in both languages', async () => {
    for (const lang of ['de', 'en'] as const) {
      document.documentElement.lang = lang;
      await mount('/datenschutz');
      const text = norm(document.querySelector('main')?.textContent);
      expect(text, lang).toMatch(/cookie/i);
      expect(text, lang).toContain('localStorage');
      expect(text, lang).toMatch(lang === 'de' ? /Tracking/ : /tracking/i);
      cleanup();
    }
  });

  it('Q-legal: footer links work, focus goes to the h1, and the title follows the language', async () => {
    document.documentElement.lang = 'de';
    await mount('/', 'admin');
    const footer = () => document.querySelector('footer') as HTMLElement;
    await act(async () => {
      fireEvent.click(within(footer()).getByRole('link', { name: 'Impressum' }));
      await sleep(30);
    });
    expect((await load()).state.location.pathname).toBe('/impressum');
    expect(h1().textContent).toContain('Impressum');
    expect(document.activeElement).toBe(h1());
    expect(document.title).toBe('Impressum – mfe-lab');

    await act(async () => {
      fireEvent.click(within(footer()).getByRole('link', { name: 'Datenschutz' }));
      await sleep(30);
    });
    expect((await load()).state.location.pathname).toBe('/datenschutz');
    expect(document.title).toBe('Datenschutz – mfe-lab');

    await setLocale('en');
    expect(document.title).toBe('Privacy – mfe-lab');
    expect(h1().textContent).toContain('Privacy');
  });
});

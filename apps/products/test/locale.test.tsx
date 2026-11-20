/** @vitest-environment jsdom */
import type { Product } from '@mfe/api-client';
import { login, logout } from '@mfe/auth-store';
import { emit, onAny } from '@mfe/events';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ProductsApp from '../src/ProductsApp.tsx';

beforeAll(() => {
  const proto = HTMLDialogElement.prototype;
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.show ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

const norm = (s: string | null | undefined) =>
  (s ?? '').replace(new RegExp('[\u00a0\u202f]', 'g'), ' ');
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const data: Product[] = Array.from({ length: 30 }, (_, i) => ({
  id: i + 1,
  sku: `SKU-${String(i + 1).padStart(4, '0')}`,
  name: i === 0 ? 'Drucksensor' : `Produkt ${i + 1}`,
  price_cents: i === 0 ? 67428 : (i + 1) * 100,
  stock: i + 1,
  created_at: '2026-11-20T23:30:00.000Z',
}));

type Sent = { method: string; path: string; body: Record<string, unknown> | undefined };
const sent: Sent[] = [];
let detailStatus = 200;
beforeEach(() => {
  sent.length = 0;
  detailStatus = 200;
  localStorage.clear();
  document.documentElement.lang = 'en';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url, 'http://x');
      const method = init?.method ?? 'GET';
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      if (u.pathname === '/api/auth/login')
        return json(200, { token: 't', user: { id: 1, email: body.email, role: 'editor' } });
      sent.push({ method, path: u.pathname, body });
      const m = /^\/api\/products\/(\d+)$/.exec(u.pathname);
      if (m && method === 'GET') {
        if (detailStatus === 404) return json(404, { error: 'not_found' });
        return json(
          200,
          data.find((p) => p.id === Number(m[1])),
        );
      }
      if (method === 'DELETE') return new Response(null, { status: 204 });
      if (method === 'POST')
        return json(201, { ...body, id: 999, created_at: '2026-11-20T00:00:00.000Z' });
      if (method === 'PUT' || method === 'PATCH')
        return json(200, { ...data[Number(u.pathname.split('/').at(-1)) - 1], ...body });
      const page = Number(u.searchParams.get('page') ?? 1);
      const limit = Number(u.searchParams.get('limit') ?? 20);
      return json(200, {
        items: data.slice((page - 1) * limit, page * limit),
        total: data.length,
        page,
        limit,
      });
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
const mount = async (path = '/') => {
  await act(() => login('editor@lab.test', 'lab12345'));
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/*" element={<ProductsApp />} />
        </Routes>
      </MemoryRouter>,
    );
    await sleep(20);
  });
};
const click = (el: HTMLElement) =>
  act(async () => {
    fireEvent.click(el);
    await sleep(20);
  });
const type = (el: HTMLElement, value: string) =>
  act(() => void fireEvent.change(el, { target: { value } }));
const setLocale = (locale: 'de' | 'en') =>
  act(async () => {
    document.documentElement.lang = locale;
    emit('locale:changed', { locale });
    await sleep(20);
  });
const rowText = (i = 0) => norm(document.querySelectorAll('tbody tr')[i]?.textContent);
const dialog = () => document.querySelector('dialog[open]') as HTMLElement;
// The labels of the form are German in DE and not part of the contract, so fields are found by
// their stable markup: the order SKU, Name, Price, Stock and the decimal input mode of Price.
const fields = () => {
  const inputs = Array.from(dialog().querySelectorAll<HTMLInputElement>('input'));
  const price = dialog().querySelector<HTMLInputElement>('input[inputmode="decimal"]')!;
  return { sku: inputs[0]!, name: inputs[1]!, price, stock: inputs[3]! };
};
const errorText = (input: HTMLElement) =>
  norm(
    (input.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' '),
  ).trim();
const fillForm = async (price: string) => {
  const f = fields();
  await type(f.sku, 'NEW-1');
  await type(f.name, 'Neu');
  await type(f.price, price);
  await type(f.stock, '3');
};
const save = () => dialog().querySelector<HTMLButtonElement>('button[type="submit"]')!;

describe('products in DE', () => {
  it('Q-remote-locale: re-renders in place on locale:changed (list)', async () => {
    await mount();
    expect(screen.getByRole('button', { name: 'Add product' })).toBeTruthy();
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
    expect(rowText()).toContain('€674.28');
    expect(rowText()).toContain('20/11/2026');
    const row = document.querySelector('tbody tr');

    await setLocale('de');
    expect(screen.queryByRole('button', { name: 'Add product' })).toBeNull();
    expect(screen.queryByText('Page 1 of 3')).toBeNull();
    expect(rowText()).toContain('674,28 €');
    expect(rowText()).toContain('20.11.2026');
    expect(rowText()).toContain('Drucksensor');
    expect(document.querySelector('tbody tr')).toBe(row); // same DOM, not remounted

    await setLocale('en');
    expect(screen.getByRole('button', { name: 'Add product' })).toBeTruthy();
    expect(rowText()).toContain('€674.28');
  });

  it('Q-remote-locale: a remote mounted after a switch reads <html lang>', async () => {
    document.documentElement.lang = 'de';
    await mount();
    expect(screen.queryByRole('button', { name: 'Add product' })).toBeNull();
    expect(screen.queryByText('Page 1 of 3')).toBeNull();
    expect(rowText()).toContain('674,28 €');
    expect(rowText()).toContain('20.11.2026');
  });

  it('Q-de-strings: detail shows the German price, date, VAT note and title', async () => {
    document.documentElement.lang = 'de';
    await mount('/1');
    expect(screen.getByRole('heading', { level: 3, name: 'Drucksensor' })).toBeTruthy();
    const text = norm(document.querySelector('dl')?.textContent);
    expect(text).toContain('674,28 €');
    expect(text).toContain('20.11.2026');
    expect(norm(document.body.textContent)).toContain('inkl. 19 % MwSt.');
    expect(document.title).toBe('Drucksensor – Produkte – mfe-lab');
  });

  it('Q-de-strings: detail in EN has the EN VAT note; a switch updates it in place', async () => {
    await mount('/1');
    expect(norm(document.body.textContent)).toContain('incl. 19% VAT');
    expect(document.title).toBe('Drucksensor – Products – mfe-lab');
    await setLocale('de');
    expect(norm(document.body.textContent)).toContain('inkl. 19 % MwSt.');
    expect(norm(document.body.textContent)).not.toContain('incl. 19% VAT');
    expect(document.title).toBe('Drucksensor – Produkte – mfe-lab');
  });

  it('Q-de-strings: not found title', async () => {
    document.documentElement.lang = 'de';
    detailStatus = 404;
    await mount('/1');
    expect(document.title).toBe('Produkt nicht gefunden – Produkte – mfe-lab');
  });

  it('Q-de-strings: announcements say "Produkt <sku> angelegt / gespeichert / gelöscht"', async () => {
    await mount();
    // Labels of the German UI are not in the contract: grab the controls in EN, then switch.
    const add = screen.getByRole('button', { name: 'Add product' });
    const edit = screen.getByRole('button', { name: 'Edit SKU-0002' });
    const del = screen.getByRole('button', { name: 'Delete SKU-0003' });
    await setLocale('de');
    const announced: string[] = [];
    const off = onAny((e) => {
      if (e.name === 'a11y:announce') announced.push((e.detail as { message: string }).message);
    });

    await click(add);
    await fillForm('1,50');
    await click(save());
    expect(announced).toEqual(['Produkt NEW-1 angelegt']);

    announced.length = 0;
    await click(edit);
    await type(fields().name, 'Umbenannt');
    await click(save());
    expect(announced).toEqual(['Produkt SKU-0002 gespeichert']);

    announced.length = 0;
    await click(del);
    const confirm = Array.from(dialog().querySelectorAll('button')).at(-1)!; // [Cancel, Delete]
    await click(confirm);
    expect(announced).toEqual(['Produkt SKU-0003 gelöscht']);
    off();
  });
});

describe('price input', () => {
  const create = async (price: string, lang: 'en' | 'de' = 'en') => {
    await mount();
    await click(screen.getByRole('button', { name: 'Add product' }));
    if (lang === 'de') await setLocale('de'); // the dialog stays open
    await fillForm(price);
    await click(save());
  };
  const posts = () => sent.filter((r) => r.method === 'POST');

  it('Q-price-input: 674,28 and 674.28 both save as 67428 cents, in EN and DE', async () => {
    for (const lang of ['en', 'de'] as const) {
      for (const price of ['674,28', '674.28']) {
        sent.length = 0;
        document.documentElement.lang = 'en';
        await create(price, lang);
        expect(
          posts().map((p) => p.body?.price_cents),
          `${lang} ${price}`,
        ).toEqual([67428]);
        cleanup();
        logout();
      }
    }
  });

  it('Q-price-input: whole numbers and one decimal still work', async () => {
    await create('9,5');
    expect(posts().map((p) => p.body?.price_cents)).toEqual([950]);
  });

  it('Q-price-input: 674,289 and 1.234,00 are rejected, nothing is sent', async () => {
    for (const price of ['674,289', '1.234,00']) {
      sent.length = 0;
      await create(price);
      expect(posts(), price).toEqual([]);
      expect(dialog(), price).not.toBeNull();
      expect(errorText(fields().price), price).not.toBe('');
      cleanup();
      logout();
    }
  });

  it('Q-price-input: the rejection message is translated in DE', async () => {
    await mount();
    await click(screen.getByRole('button', { name: 'Add product' }));
    await fillForm('674,289');
    await click(save());
    const en = errorText(fields().price);
    expect(en).toMatch(/price/i);

    await setLocale('de'); // the dialog stays open, then submit again
    await click(save());
    const de = errorText(fields().price);
    expect(de).not.toBe('');
    expect(de).not.toBe(en);
    expect(de).not.toMatch(/must be/i);
    expect(sent.filter((r) => r.method === 'POST')).toEqual([]);
  });

  it('Q-price-input: edit pre-fills 674,28 in DE and 674.28 in EN', async () => {
    await mount();
    const edit = screen.getByRole('button', { name: 'Edit SKU-0001' });
    await click(edit);
    expect(fields().price.value).toBe('674.28');
    await click(dialog().querySelector('button:not([type="submit"])')! as HTMLElement); // close

    await setLocale('de');
    await click(edit);
    expect(fields().price.value).toBe('674,28');
    expect(within(dialog()).getByDisplayValue('Drucksensor')).toBeTruthy();
  });
});

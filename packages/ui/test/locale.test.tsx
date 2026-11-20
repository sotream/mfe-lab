/** @vitest-environment jsdom */
import { emit } from '@mfe/events';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectLocale, formatDate, formatMoney, formatTime, useLocale } from '../src/index.ts';

const KEY = 'mfe-lab:locale';
const norm = (s: string) => s.replace(new RegExp('[\u00a0\u202f]', 'g'), ' ');
const setLanguages = (langs: string[]) =>
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(langs);

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = '';
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.lang = '';
});

describe('detectLocale', () => {
  it('Q-locale-detect: a saved de or en wins over the browser', () => {
    setLanguages(['en-US']);
    localStorage.setItem(KEY, 'de');
    expect(detectLocale()).toBe('de');
    setLanguages(['de-DE']);
    localStorage.setItem(KEY, 'en');
    expect(detectLocale()).toBe('en');
  });

  it('Q-locale-detect: an invalid saved value is ignored', () => {
    localStorage.setItem(KEY, 'fr');
    setLanguages(['de-DE']);
    expect(detectLocale()).toBe('de');
    setLanguages(['en-US']);
    expect(detectLocale()).toBe('en');
  });

  it('Q-locale-detect: navigator.languages decides when nothing is saved', () => {
    const cases: [string[], string][] = [
      [['de-AT'], 'de'],
      [['de'], 'de'],
      [['fr', 'de'], 'de'],
      [['en-US'], 'en'],
      [['fr', 'es'], 'en'],
    ];
    for (const [langs, want] of cases) {
      setLanguages(langs);
      expect(detectLocale(), langs.join()).toBe(want);
    }
  });

  it('Q-locale-detect: a storage that throws falls back to navigator detection', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    setLanguages(['de-DE']);
    expect(detectLocale()).toBe('de');
    setLanguages(['en-US']);
    expect(detectLocale()).toBe('en');
  });
});

describe('formatters', () => {
  it('Q-format: formatMoney is EUR, de-DE or en-GB', () => {
    expect(norm(formatMoney(67428, 'de'))).toBe('674,28 €');
    expect(formatMoney(67428, 'en')).toBe('€674.28');
    expect(norm(formatMoney(0, 'de'))).toBe('0,00 €');
    expect(formatMoney(0, 'en')).toBe('€0.00');
    expect(norm(formatMoney(123_456_789, 'de'))).toBe('1.234.567,89 €');
    expect(formatMoney(123_456_789, 'en')).toBe('€1,234,567.89');
    // the DE form uses a non-breaking space before the euro sign
    expect(formatMoney(67428, 'de')).toMatch(new RegExp('\\d[\\u00a0\\u202f]€$'));
  });

  it('Q-format: formatDate shows the calendar day from the ISO date, never shifted', () => {
    expect(formatDate('2026-11-20T23:30:00Z', 'de')).toBe('20.11.2026');
    expect(formatDate('2026-11-20T23:30:00Z', 'en')).toBe('20/11/2026');
    expect(formatDate('2026-11-20T00:00:00.000Z', 'de')).toBe('20.11.2026');
    expect(formatDate('2026-10-01', 'de')).toBe('01.10.2026');
    expect(formatDate('2026-10-01', 'en')).toBe('01/10/2026');
  });

  it('Q-format: formatTime is 24-hour HH:MM:SS in both locales', () => {
    const d = new Date(2026, 10, 20, 15, 4, 5); // local time
    expect(formatTime(d, 'de')).toBe('15:04:05');
    expect(formatTime(d, 'en')).toBe('15:04:05');
    expect(formatTime(new Date(2026, 10, 20, 0, 7, 9), 'en')).toBe('00:07:09');
  });
});

describe('useLocale', () => {
  const Show = () => <p>{useLocale()}</p>;

  it('Q-locale-switch: reads and normalizes <html lang> on mount', () => {
    for (const [lang, want] of [
      ['de', 'de'],
      ['de-DE', 'de'],
      ['en', 'en'],
      ['fr', 'en'],
      ['', 'en'],
    ] as const) {
      document.documentElement.lang = lang;
      render(<Show />);
      expect(screen.getByText(want, { selector: 'p' }), lang).toBeTruthy();
      cleanup();
    }
  });

  it('Q-locale-switch: re-renders on locale:changed', async () => {
    document.documentElement.lang = 'en';
    render(<Show />);
    expect(screen.getByText('en')).toBeTruthy();
    await act(async () => {
      document.documentElement.lang = 'de';
      emit('locale:changed', { locale: 'de' });
    });
    expect(screen.getByText('de')).toBeTruthy();
    await act(async () => {
      document.documentElement.lang = 'en';
      emit('locale:changed', { locale: 'en' });
    });
    expect(screen.getByText('en')).toBeTruthy();
  });
});

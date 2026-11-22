import { on } from '@mfe/events';
import { useSyncExternalStore } from 'react';

// Locale across remotes (RFC 0012): the shell owns it, `<html lang>` carries it, `locale:changed` announces a switch.
export type Locale = 'de' | 'en';

export const LOCALE_KEY = 'mfe-lab:locale';

export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_KEY);
    if (saved === 'de' || saved === 'en') return saved;
  } catch {
    // storage unavailable: same as not saved
  }
  return navigator.languages.find((l) => l.toLowerCase().startsWith('de')) ? 'de' : 'en';
}

export const currentLocale = (): Locale =>
  document.documentElement.lang.startsWith('de') ? 'de' : 'en';

const subscribeLocale = (cb: () => void) => on('locale:changed', cb);

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, currentLocale);
}

const tag = (locale: Locale) => (locale === 'de' ? 'de-DE' : 'en-GB');

export const formatMoney = (cents: number, locale: Locale): string =>
  new Intl.NumberFormat(tag(locale), { style: 'currency', currency: 'EUR' }).format(cents / 100);

export const formatNumber = (n: number, locale: Locale): string =>
  new Intl.NumberFormat(tag(locale)).format(n);

// A calendar date: read it in UTC so the day never shifts with the viewer's zone.
export const formatDate = (iso: string, locale: Locale): string =>
  new Date(iso).toLocaleDateString(tag(locale), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });

export const formatTime = (date: Date, locale: Locale): string =>
  date.toLocaleTimeString(tag(locale), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

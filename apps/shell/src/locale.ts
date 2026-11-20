import { emit } from '@mfe/events';
import { LOCALE_KEY, type Locale } from '@mfe/ui';

// The shell owns the locale (RFC 0012): lang for readers and assistive tech, storage for the next visit, the event for remotes.
export function setLocale(locale: Locale): void {
  document.documentElement.lang = locale;
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // storage unavailable: the choice lasts until reload
  }
  emit('locale:changed', { locale });
}

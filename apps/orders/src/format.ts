// Same formats as @mfe/ui's formatters (RFC 0012), written against Intl directly: the React entry
// of @mfe/ui must not end up in this remote's bundle (RFC 0016).
export type Locale = 'de' | 'en';

const tag = (locale: Locale) => (locale === 'de' ? 'de-DE' : 'en-GB');

export const formatMoney = (cents: number, locale: Locale): string =>
  new Intl.NumberFormat(tag(locale), { style: 'currency', currency: 'EUR' }).format(cents / 100);

// A calendar date: read it in UTC so the day never shifts with the viewer's zone.
export const formatDate = (iso: string, locale: Locale): string =>
  new Date(iso).toLocaleDateString(tag(locale), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });

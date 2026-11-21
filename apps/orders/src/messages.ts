import type { Locale } from './format.ts';

const de = {
  caption: 'Bestellungen',
  filter: 'Status',
  all: 'Alle',
  status: { new: 'neu', paid: 'bezahlt', shipped: 'versandt' },
  cols: {
    id: 'Nr.',
    product: 'Produkt',
    qty: 'Menge',
    total: 'Summe',
    status: 'Status',
    date: 'Datum',
  },
  loading: 'Bestellungen werden geladen…',
  empty: 'Keine Bestellungen gefunden',
  failed: 'Bestellungen konnten nicht geladen werden',
  retry: 'Erneut versuchen',
  prev: 'Zurück',
  next: 'Weiter',
  page: (page: number, pages: number) => `Seite ${page} von ${pages}`,
  total: (n: number) => `${n} Bestellungen`,
  unknownProduct: (id: number) => `Produkt ${id}`,
  standalone: {
    title: 'Standalone-Entwicklung. Anmelden als',
    signedIn: (email: string, role: string) => `angemeldet als ${email} (${role})`,
    signedOut: 'nicht angemeldet',
  },
};

const en: typeof de = {
  caption: 'Orders',
  filter: 'Status',
  all: 'All',
  status: { new: 'new', paid: 'paid', shipped: 'shipped' },
  cols: {
    id: 'No.',
    product: 'Product',
    qty: 'Qty',
    total: 'Total',
    status: 'Status',
    date: 'Date',
  },
  loading: 'Loading orders…',
  empty: 'No orders found',
  failed: 'Could not load orders',
  retry: 'Retry',
  prev: 'Previous',
  next: 'Next',
  page: (page, pages) => `Page ${page} of ${pages}`,
  total: (n) => `${n} orders`,
  unknownProduct: (id) => `Product ${id}`,
  standalone: {
    title: 'Standalone dev. Sign in as',
    signedIn: (email, role) => `signed in as ${email} (${role})`,
    signedOut: 'not signed in',
  },
};

export const messages: Record<Locale, typeof de> = { de, en };

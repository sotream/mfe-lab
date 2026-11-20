import { useLocale } from '@mfe/ui';

const de = {
  standalone: {
    title: 'Standalone-Entwicklung. Anmelden als',
    signedIn: (email: string, role: string) => `angemeldet als ${email} (${role})`,
    signedOut: 'nicht angemeldet',
  },
  loadFailed: 'Dashboard konnte nicht geladen werden',
  retry: 'Erneut versuchen',
  loading: 'Dashboard wird geladen…',
  tiles: {
    products: 'Produkte',
    orders: 'Bestellungen',
    revenue: 'Umsatz',
    paid: 'Bezahlter Umsatz',
  },
  ordersPerDay: 'Bestellungen pro Tag',
  noOrders: 'Noch keine Bestellungen',
  chartLabel: (first: string, last: string, total: string, peak: string, day: string) =>
    `Bestellungen pro Tag, ${first} bis ${last}: ${total} Bestellungen, Spitze ${peak} am ${day}`,
  tooltip: (day: string, count: string) => `${day}: ${count} Bestellungen`,
  revenueByStatus: 'Umsatz nach Status',
  status: { new: 'neu', paid: 'bezahlt', shipped: 'versandt' },
  showTable: 'Datentabelle anzeigen',
  date: 'Datum',
  orders: 'Bestellungen',
};

const en: typeof de = {
  standalone: {
    title: 'Standalone dev. Sign in as',
    signedIn: (email, role) => `signed in as ${email} (${role})`,
    signedOut: 'not signed in',
  },
  loadFailed: 'Could not load dashboard',
  retry: 'Retry',
  loading: 'Loading dashboard…',
  tiles: { products: 'Products', orders: 'Orders', revenue: 'Revenue', paid: 'Paid revenue' },
  ordersPerDay: 'Orders per day',
  noOrders: 'No orders yet',
  chartLabel: (first, last, total, peak, day) =>
    `Orders per day, ${first} to ${last}: ${total} orders, peak ${peak} on ${day}`,
  tooltip: (day, count) => `${day}: ${count} orders`,
  revenueByStatus: 'Revenue by status',
  status: { new: 'new', paid: 'paid', shipped: 'shipped' },
  showTable: 'Show data table',
  date: 'Date',
  orders: 'Orders',
};

const messages = { de, en };
export const useT = () => messages[useLocale()];

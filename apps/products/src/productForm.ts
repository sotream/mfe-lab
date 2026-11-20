import type { ProductInput } from '@mfe/api-client';
import type { Locale } from '@mfe/ui';
import { messages, type Messages } from './messages.ts';

export type FormValues = { sku: string; name: string; price: string; stock: string };
export type FormErrors = Partial<Record<keyof FormValues, string>>;

const MAX_STOCK = 1_000_000;

function required(value: string, label: string, max: number, t: Messages): string | undefined {
  if (!value) return t.form.required(label);
  if (value.length > max) return t.form.tooLong(label, max);
  return undefined;
}

// Price: comma or dot as the decimal mark, at most two decimals, no thousands separators.
export function validateProductForm(
  v: FormValues,
  t: Messages = messages.en,
): { input: ProductInput; errors: Record<string, never> } | { input: null; errors: FormErrors } {
  const sku = v.sku.trim();
  const name = v.name.trim();
  const price = v.price.trim();
  const stock = v.stock.trim();

  const found: FormErrors = {
    sku: required(sku, 'SKU', 32, t),
    name: required(name, t.columns.name, 120, t),
    price: /^\d+([.,]\d{1,2})?$/.test(price) ? undefined : t.form.price,
    stock: /^\d+$/.test(stock) && Number(stock) <= MAX_STOCK ? undefined : t.form.stock,
  };
  // Keep only the invalid fields, so valid ones have no key at all.
  const errors = Object.fromEntries(Object.entries(found).filter(([, msg]) => msg)) as FormErrors;
  if (Object.keys(errors).length > 0) return { input: null, errors };

  return {
    input: {
      sku,
      name,
      price_cents: Math.round(Number(price.replace(',', '.')) * 100),
      stock: Number(stock),
    },
    errors: {},
  };
}

// Edit pre-fills the price in the locale's decimal mark.
export const centsToPriceInput = (cents: number, locale: Locale = 'en'): string => {
  const text = (cents / 100).toFixed(2);
  return locale === 'de' ? text.replace('.', ',') : text;
};

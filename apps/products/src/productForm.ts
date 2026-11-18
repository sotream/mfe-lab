import type { ProductInput } from '@mfe/api-client';

export type FormValues = { sku: string; name: string; price: string; stock: string };
export type FormErrors = Partial<Record<keyof FormValues, string>>;

const MAX_STOCK = 1_000_000;

function required(value: string, label: string, max: number): string | undefined {
  if (!value) return `${label} is required`;
  if (value.length > max) return `${label} must be at most ${max} characters`;
  return undefined;
}

export function validateProductForm(
  v: FormValues,
): { input: ProductInput; errors: Record<string, never> } | { input: null; errors: FormErrors } {
  const sku = v.sku.trim();
  const name = v.name.trim();
  const price = v.price.trim();
  const stock = v.stock.trim();

  const found: FormErrors = {
    sku: required(sku, 'SKU', 32),
    name: required(name, 'Name', 120),
    price: /^\d+(\.\d{1,2})?$/.test(price)
      ? undefined
      : 'Price must be a number with up to 2 decimals',
    stock:
      /^\d+$/.test(stock) && Number(stock) <= MAX_STOCK
        ? undefined
        : 'Stock must be a whole number ≥ 0',
  };
  // Keep only the invalid fields, so valid ones have no key at all.
  const errors = Object.fromEntries(Object.entries(found).filter(([, msg]) => msg)) as FormErrors;
  if (Object.keys(errors).length > 0) return { input: null, errors };

  return {
    input: { sku, name, price_cents: Math.round(Number(price) * 100), stock: Number(stock) },
    errors: {},
  };
}

export const formatPrice = (cents: number): string =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const centsToPriceInput = (cents: number): string => (cents / 100).toFixed(2);

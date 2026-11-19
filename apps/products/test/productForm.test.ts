import { describe, expect, it } from 'vitest';
import {
  centsToPriceInput,
  formatPrice,
  validateProductForm,
  type FormValues,
} from '../src/productForm.ts';

const valid: FormValues = { sku: 'SKU-1', name: 'Thing', price: '12.34', stock: '5' };
const errorsFor = (patch: Partial<FormValues>) => validateProductForm({ ...valid, ...patch });

const priceMsg = 'Price must be a number with up to 2 decimals';
const stockMsg = 'Stock must be a whole number ≥ 0';

describe('productForm', () => {
  it('Q-form-valid: trimmed strings and cents', () => {
    expect(
      validateProductForm({ sku: '  SKU-1 ', name: ' Thing  ', price: ' 12.30 ', stock: ' 5 ' }),
    ).toEqual({
      input: { sku: 'SKU-1', name: 'Thing', price_cents: 1230, stock: 5 },
      errors: {},
    });
  });

  it('Q-form-errors: each rule gives its exact message; all errors reported together', () => {
    const cases: [Partial<FormValues>, keyof FormValues, string][] = [
      [{ sku: '' }, 'sku', 'SKU is required'],
      [{ sku: '   ' }, 'sku', 'SKU is required'],
      [{ sku: 'X'.repeat(33) }, 'sku', 'SKU must be at most 32 characters'],
      [{ name: '' }, 'name', 'Name is required'],
      [{ name: 'N'.repeat(121) }, 'name', 'Name must be at most 120 characters'],
      [{ price: 'abc' }, 'price', priceMsg],
      [{ stock: '1.5' }, 'stock', stockMsg],
      [{ stock: '-1' }, 'stock', stockMsg],
      [{ stock: '1000001' }, 'stock', stockMsg],
    ];
    for (const [patch, field, message] of cases) {
      expect(errorsFor(patch), JSON.stringify(patch)).toEqual({
        input: null,
        errors: { [field]: message },
      });
    }
    expect(
      errorsFor({ sku: 'X'.repeat(32), name: 'N'.repeat(120), stock: '1000000' }).input,
    ).toEqual({ sku: 'X'.repeat(32), name: 'N'.repeat(120), price_cents: 1234, stock: 1_000_000 });
    expect(validateProductForm({ sku: '', name: '', price: '', stock: '' })).toEqual({
      input: null,
      errors: {
        sku: 'SKU is required',
        name: 'Name is required',
        price: priceMsg,
        stock: stockMsg,
      },
    });
  });

  it('Q-form-price: rejects 12.345, -1, 1e3, .5 and empty; accepts 0, 0.5, 12.30', () => {
    for (const price of ['12.345', '-1', '1e3', '.5', '']) {
      expect(errorsFor({ price }), price).toEqual({ input: null, errors: { price: priceMsg } });
    }
    const accepted: [string, number][] = [
      ['0', 0],
      ['0.5', 50],
      ['12.30', 1230],
      ['12.3', 1230],
      ['0.07', 7],
    ];
    for (const [price, cents] of accepted) {
      expect(errorsFor({ price }).input?.price_cents, price).toBe(cents);
    }
  });

  it('Q-format: formatPrice and centsToPriceInput examples', () => {
    expect(formatPrice(1234)).toBe('$12.34');
    expect(formatPrice(0)).toBe('$0.00');
    expect(formatPrice(100_000)).toBe('$1,000.00');
    expect(centsToPriceInput(1234)).toBe('12.34');
  });
});

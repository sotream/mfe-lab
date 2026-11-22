import { describe, expect, it } from 'vitest';
// ASSUMPTION: apps/api/src/totp.ts exports `totp(secretBase32: string, atMs: number, digits = 6): string`
// (HMAC-SHA1, 30 s step, dynamic truncation, zero-padded).
import { totp } from '../src/totp.ts';
import { b32encode, refTotp } from './owner.ts';

// RFC 6238 Appendix B, SHA1, secret "12345678901234567890", 8 digits.
const secret = b32encode(Buffer.from('12345678901234567890'));
const vectors: [number, string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('totp', () => {
  it('Q-totp: the test secret encodes to the known base32 value', () => {
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it.each(vectors)('Q-totp: RFC 6238 vector at T=%i gives %s (8 digits)', (t, code) => {
    expect(totp(secret, t * 1000, 8)).toBe(code);
    expect(refTotp(Buffer.from('12345678901234567890'), t * 1000, 8)).toBe(code); // the reference agrees
  });

  it.each(vectors)(
    'Q-totp: the default is 6 digits, the last 6 of the vector (T=%i)',
    (t, code) => {
      expect(totp(secret, t * 1000)).toBe(code.slice(2));
    },
  );

  it('Q-totp: stable inside one 30 s step, changes at the boundary', () => {
    expect(totp(secret, 30_000)).toBe(totp(secret, 59_999));
    expect(totp(secret, 59_999)).not.toBe(totp(secret, 60_000));
  });
});

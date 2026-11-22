import { createHmac, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_S = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of s.replace(/[\s=]/g, '').toUpperCase()) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// RFC 4226 HOTP (HMAC-SHA1, dynamic truncation).
export function hotp(key: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  const bin = h.readUInt32BE(o) & 0x7fffffff;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

// RFC 6238: 30 s steps.
export const totpStep = (nowMs: number) => Math.floor(nowMs / 1000 / STEP_S);

// Returns the matching time step within +-1 step, or null. Constant-time compare per candidate.
// The caller rejects a step that was already used (replay).
export function verifyTotp(secretB32: string, code: string, nowMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  let key: Buffer;
  try {
    key = base32Decode(secretB32);
  } catch {
    return null;
  }
  const given = Buffer.from(code);
  const now = totpStep(nowMs);
  let hit: number | null = null;
  for (const step of [now - 1, now, now + 1]) {
    if (timingSafeEqual(Buffer.from(hotp(key, step)), given)) hit = step; // no early exit
  }
  return hit;
}

// Code for the 30 s step containing atMs (RFC 6238); secret is base32.
export const totp = (secretB32: string, atMs: number, digits = 6): string =>
  hotp(base32Decode(secretB32), totpStep(atMs), digits);

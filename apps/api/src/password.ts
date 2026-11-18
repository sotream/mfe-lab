import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEY_LEN = 64;

const derive = (plain: string, salt: Buffer, keyLen: number) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(plain, salt, keyLen, (err, key) => (err ? reject(err) : resolve(key))),
  );

// Format: scrypt$<salt b64>$<hash b64>
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(plain, salt, KEY_LEN);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

// Never throws: wrong password or malformed stored value gives false.
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  try {
    const [scheme, saltB64, hashB64, ...rest] = stored.split('$');
    if (scheme !== 'scrypt' || !saltB64 || !hashB64 || rest.length > 0) return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    if (salt.length === 0 || expected.length === 0) return false;
    return timingSafeEqual(await derive(plain, salt, expected.length), expected);
  } catch {
    return false;
  }
}

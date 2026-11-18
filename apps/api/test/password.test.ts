import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/password.ts';
import { seed } from '../src/seed.ts';
import { freshDb } from './helpers.ts';

const demo = 'lab12345'; // demo-only seed password, see README

describe('password', () => {
  it('Q-pw: seeded hashes verify, use scrypt format, and are salted', async () => {
    const db = freshDb();
    await seed(db);
    const users = db.prepare('SELECT email, password_hash FROM users').all() as {
      email: string;
      password_hash: string;
    }[];
    expect(users).toHaveLength(3);
    for (const { email, password_hash: hash } of users) {
      expect(hash, email).toMatch(/^scrypt\$/);
      expect(hash, email).not.toContain(demo);
      expect(await verifyPassword(demo, hash), email).toBe(true);
      expect(await verifyPassword('wrong', hash), email).toBe(false);
    }
    expect(await hashPassword('x')).not.toBe(await hashPassword('x'));
  });

  it('Q-pw-malformed: malformed stored hash resolves false', async () => {
    for (const stored of ['', 'garbage', 'scrypt$$']) {
      await expect(verifyPassword('x', stored), JSON.stringify(stored)).resolves.toBe(false);
    }
  });
});

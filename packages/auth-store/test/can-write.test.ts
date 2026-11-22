import { describe, expect, it } from 'vitest';
// ASSUMPTION: `canWrite(user)` is exported from the package root: true for admin, editor and superadmin
// (the owner role counts as admin), false for viewer, null and undefined.
import { canWrite } from '../src/index.ts';

const user = (role: string) => ({ id: 1, email: 'u@test.invalid', role }) as never;

describe('canWrite', () => {
  it.each(['admin', 'editor', 'superadmin'])('Q-can-write: %s may write', (role) => {
    expect(canWrite(user(role))).toBe(true);
  });
  it.each(['viewer'])('Q-can-write: %s may not write', (role) => {
    expect(canWrite(user(role))).toBe(false);
  });
  it('Q-can-write: no user, no write', () => {
    expect(canWrite(null)).toBe(false);
    expect(canWrite(undefined)).toBe(false);
  });
});

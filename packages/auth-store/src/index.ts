// Framework-free core (RFC 0002, RFC 0016): no UI framework import, so a Vue or plain-JS remote shares the
// same singleton. The React hook is the subpath `@mfe/auth-store/react`.
// 'superadmin' is the owner account; remotes treat it like 'admin' with every write allowed.
export type Role = 'superadmin' | 'admin' | 'editor' | 'viewer';
// demo: the API says this user is a locked demo user (destructive actions refused). Never guessed here.
export type User = { id: number; email: string; role: Role; demo?: boolean };
export type Status = 'anonymous' | 'loading' | 'authenticated';
export type AuthState = { user: User | null; token: string | null; status: Status };

// The token lives in memory only (RFC 0002): a reload logs the user out.
const anonymous: AuthState = { user: null, token: null, status: 'anonymous' };
let state: AuthState = anonymous;
const listeners = new Set<() => void>();

function setState(next: AuthState) {
  state = next;
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getState = (): AuthState => state;

export const getToken = (): string | null => state.token;

// One rule for every remote. canWrite: create and edit; canAdmin: inspector admin forms;
// canDestroy: delete products, flags, registry, errors (false for the locked public demo).
type MaybeUser = User | null | undefined;
export const canWrite = (u: MaybeUser): boolean =>
  u?.role === 'admin' || u?.role === 'editor' || u?.role === 'superadmin';
export const canAdmin = (u: MaybeUser): boolean => u?.role === 'admin' || u?.role === 'superadmin';
// Display label for a role chip; the owner account reads "owner".
export const roleLabel = (role: Role): string => (role === 'superadmin' ? 'owner' : role);
export const canDestroy = (u: MaybeUser): boolean => canWrite(u) && !u?.demo;

export function logout(): void {
  setState(anonymous);
}

// Rejects with Error(message = API error code | 'http_error' | 'network_error'); 'otp_required' means resubmit with a code.
export async function login(email: string, password: string, otp?: string): Promise<void> {
  setState({ ...anonymous, status: 'loading' });
  let res: Response;
  try {
    res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, ...(otp ? { otp } : {}) }),
    });
  } catch {
    setState(anonymous);
    throw new Error('network_error');
  }
  const body = (await res.json().catch(() => null)) as {
    token?: string;
    user?: User;
    error?: string;
  } | null;
  if (!res.ok || !body?.token || !body.user) {
    setState(anonymous);
    throw new Error((!res.ok && body?.error) || 'http_error');
  }
  setState({ user: body.user, token: body.token, status: 'authenticated' });
}

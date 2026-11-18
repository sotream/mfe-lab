import { useSyncExternalStore } from 'react';

export type Role = 'admin' | 'editor' | 'viewer';
export type User = { id: number; email: string; role: Role };
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

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAuth<T>(selector: (s: AuthState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

export const getToken = (): string | null => state.token;

export function logout(): void {
  setState(anonymous);
}

// Rejects with Error(message = API error code | 'http_error' | 'network_error').
export async function login(email: string, password: string): Promise<void> {
  setState({ ...anonymous, status: 'loading' });
  let res: Response;
  try {
    res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
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

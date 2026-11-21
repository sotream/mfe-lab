import { useSyncExternalStore } from 'react';
// The bare specifier on purpose: in a federated build it resolves to the shared singleton.
import { getState, subscribe, type AuthState } from '@mfe/auth-store';

export function useAuth<T>(selector: (s: AuthState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(getState()));
}

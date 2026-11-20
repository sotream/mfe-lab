import { listFlags } from '@mfe/api-client';
import { useAuth } from '@mfe/auth-store';
import { on } from '@mfe/events';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

// Runtime flags (RFC 0009). Falls back while loading, on error and when signed out.
// A remote reads only flags with its own prefix.
export function useFlag(name: string, fallback: boolean): boolean {
  const signedIn = useAuth((s) => s.user !== null);
  const { data } = useQuery({ queryKey: ['flags'], queryFn: listFlags, enabled: signedIn });
  // Array.isArray: a backend without /flags must never break a page.
  const flag = Array.isArray(data) ? data.find((f) => f.name === name) : undefined;
  return flag ? flag.enabled : fallback;
}

// Install once in the component that owns the QueryClient: refetch when the shell changes a flag.
export function useFlagsSync(): void {
  const client = useQueryClient();
  useEffect(
    () => on('flags:changed', () => void client.invalidateQueries({ queryKey: ['flags'] })),
    [client],
  );
}

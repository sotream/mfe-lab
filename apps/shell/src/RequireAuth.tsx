import { useAuth } from '@mfe/auth-store';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  const { pathname, search } = useLocation();
  if (status !== 'authenticated') {
    return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />;
  }
  return children;
}

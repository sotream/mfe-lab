import type { RegistryRow } from '@mfe/api-client';
import { isAllowedCanary } from '../../../deploy/canary.ts';
import type { RemoteName } from '../../../federation.contract.ts';

// Manifest URLs are baked in at build time: MF_*_URL env overrides the localhost defaults.
declare const __MF_PRODUCTS_URL__: string;
declare const __MF_DASHBOARD_URL__: string;
declare const __MF_ORDERS_URL__: string;

export const stableUrls: Record<RemoteName, string> = {
  products: __MF_PRODUCTS_URL__,
  dashboard: __MF_DASHBOARD_URL__,
  orders: __MF_ORDERS_URL__,
};

// Pure resolution of a remote from the registry row (RFC 0017). No state, no side effects.
export type Variant = 'stable' | 'canary' | 'disabled';
export type Resolved = { variant: Variant; entry: string; bucket: number | null };

// FNV-1a 32-bit of `${userId}:${remote}`, mod 100. Same value in every browser, so a user stays in
// the same variant. Different remotes hash differently, so one user is not always first in line.
export function bucket(userId: number | string, remote: string): number {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(`${userId}:${remote}`)) {
    h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  }
  return h % 100;
}

// Set at build time: true only for the production deployment (VERCEL_ENV), which takes no preview canaries.
declare const __PRODUCTION__: boolean;

// A local stack (stable URLs on localhost) may also use localhost canaries; a production build never does.
const allowLocal = stableUrls.products.startsWith('http://localhost');

// disabled wins; canary only with an allowlisted URL, a signed-in user and bucket < percent; else stable.
export function resolveRemote(
  name: RemoteName,
  row: Pick<RegistryRow, 'canaryUrl' | 'canaryPercent' | 'disabled'> | undefined,
  userId: number | string | null,
): Resolved {
  const stableEntry = stableUrls[name];
  const b = userId === null ? null : bucket(userId, name);
  if (row?.disabled) return { variant: 'disabled', entry: stableEntry, bucket: b };
  // A row that fails the allowlist (written before the API enforced it) is ignored: stable.
  if (
    row?.canaryUrl &&
    isAllowedCanary(row.canaryUrl, allowLocal, __PRODUCTION__) &&
    b !== null &&
    b < row.canaryPercent
  ) {
    return { variant: 'canary', entry: row.canaryUrl, bucket: b };
  }
  return { variant: 'stable', entry: stableEntry, bucket: b };
}

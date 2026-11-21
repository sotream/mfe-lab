// Q-typecheck-negative + Q-no-dead-dts. The type checks run in `pnpm typecheck` (shell tsconfig
// includes test/): a stale @ts-expect-error or a missing error fails there. At runtime the calls
// are never made.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ExposedModule } from '../../../federation.contract.ts';
// remotes.ts talks to the MF runtime at import time; stub it as the other shell tests do.
vi.mock('@module-federation/enhanced/runtime', () => ({
  getInstance: () => null,
  init: vi.fn(),
  registerRemotes: vi.fn(),
  loadRemote: vi.fn(),
  preloadRemote: vi.fn(),
}));

import { loadPage } from '../src/remotes.ts';

// Never invoked: compile-time only.
export function typeChecks() {
  // @ts-expect-error DashboardPage is not exposed by products
  void loadPage('products', 'DashboardPage');
  // @ts-expect-error ProductsPage is not exposed by dashboard
  void loadPage('dashboard', 'ProductsPage');
  // @ts-expect-error unknown remote
  void loadPage('nope');
  void loadPage('dashboard', 'DashboardPage');
  void loadPage('products', 'ProductsApp');
  void loadPage('products');

  const ok: ExposedModule = { default: () => null, buildVersion: 'x' };
  // @ts-expect-error buildVersion is required
  const noVersion: ExposedModule = { default: () => null };
  // @ts-expect-error default is required
  const noDefault: ExposedModule = { buildVersion: 'x' };
  return [ok, noVersion, noDefault];
}

describe('federation contract types', () => {
  it('Q-typecheck-negative: compile-time checks are present', () => {
    expect(typeof typeChecks).toBe('function');
  });

  it('Q-no-dead-dts: the handwritten remotes.d.ts is gone', () => {
    expect(existsSync(resolve(import.meta.dirname, '../src/remotes.d.ts'))).toBe(false);
  });
});

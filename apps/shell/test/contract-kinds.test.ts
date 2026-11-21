// Q-contract-kinds. ASSUMPTIONS (phase 2 adapts): federation.contract.ts exports `kinds` (remote -> 'react' | 'mount')
// and the types MountModule / MountContext; loadPage('orders') resolves to MountModule, the others to a react module.
// The type checks run in `pnpm typecheck` (shell tsconfig includes test/): a stale @ts-expect-error fails there.
import { describe, expect, it, vi } from 'vitest';
import {
  exposes,
  kinds,
  type ExposedModule,
  type MountContext,
  type MountModule,
} from '../../../federation.contract.ts';
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
  const ctx: MountContext = { locale: 'de', onError: () => {} };
  const mod: MountModule = { mount: () => () => {}, buildVersion: 'x' };
  void ctx;

  // A mount module is not a react module, and the reverse.
  // @ts-expect-error a mount module has no default component
  const asReact: ExposedModule = mod;
  // @ts-expect-error a react module has no mount function
  const asMount: MountModule = { default: () => null, buildVersion: 'x' };
  // @ts-expect-error mount must return the unmount function
  const noUnmount: MountModule = { mount: () => undefined, buildVersion: 'x' };
  // @ts-expect-error buildVersion is required
  const noVersion: MountModule = { mount: () => () => {} };
  // @ts-expect-error locale is de | en
  const badLocale: MountContext = { locale: 'fr', onError: () => {} };

  // loadPage is typed per kind.
  const orders: Promise<MountModule> = loadPage('orders');
  void loadPage('orders', 'OrdersApp');
  // @ts-expect-error a react remote does not load as a mount module
  const productsAsMount: Promise<MountModule> = loadPage('products');
  // @ts-expect-error orders does not expose ProductsPage
  void loadPage('orders', 'ProductsPage');
  // @ts-expect-error OrdersApp is not exposed by products
  void loadPage('products', 'OrdersApp');
  return [asReact, asMount, noUnmount, noVersion, badLocale, orders, productsAsMount];
}

describe('federation contract kinds', () => {
  it('Q-contract-kinds: orders exposes only OrdersApp', () => {
    expect([...exposes.orders]).toEqual(['OrdersApp']);
  });

  it('Q-contract-kinds: orders is a mount remote, products and dashboard stay react', () => {
    expect(kinds.orders).toBe('mount');
    expect(kinds.products).toBe('react');
    expect(kinds.dashboard).toBe('react');
    expect(Object.keys(kinds).sort()).toEqual(Object.keys(exposes).sort());
  });

  it('Q-contract-kinds: compile-time checks are present', () => {
    expect(typeof typeChecks).toBe('function');
  });
});

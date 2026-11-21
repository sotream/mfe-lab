import type { ExposedModule, ExposedName } from '../../../federation.contract.ts';
import * as ProductsPage from './ProductsPage.tsx';
import * as ProductsApp from './ProductsApp.tsx';

// Type-only: every module the contract lists for `products` must satisfy ExposedModule, and
// every contract name must have an entry here (a missing key fails typecheck).
export const check = { ProductsPage, ProductsApp } satisfies Record<
  ExposedName<'products'>,
  ExposedModule
>;

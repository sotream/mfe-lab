import type { ExposedName, MountModule } from '../../../federation.contract.ts';
import * as OrdersApp from './OrdersApp.ts';

// Type-only: every module the contract lists for `orders` must satisfy MountModule, and every
// contract name must have an entry here (a missing key fails typecheck).
export const check = { OrdersApp } satisfies Record<ExposedName<'orders'>, MountModule>;

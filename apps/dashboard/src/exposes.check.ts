import type { ExposedModule, ExposedName } from '../../../federation.contract.ts';
import * as DashboardPage from './DashboardPage.tsx';

// Type-only: every module the contract lists for `dashboard` must satisfy ExposedModule, and
// every contract name must have an entry here (a missing key fails typecheck).
export const check = { DashboardPage } satisfies Record<ExposedName<'dashboard'>, ExposedModule>;

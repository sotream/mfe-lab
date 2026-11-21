/** @vitest-environment jsdom */
// Q-provider-shape: every module the contract lists for `products` is a valid ExposedModule.
import { describe, expect, it } from 'vitest';
import { exposes } from '../../../federation.contract.ts';

describe('products provider shape', () => {
  for (const name of exposes.products) {
    it(`Q-provider-shape: ${name} has a component default and a build version`, async () => {
      const mod = (await import(`../src/${name}.tsx`)) as Record<string, unknown>;
      // React components are functions, or objects (memo/forwardRef) with a render/type.
      expect(['function', 'object']).toContain(typeof mod.default);
      expect(mod.default).toBeTruthy();
      expect(typeof mod.buildVersion).toBe('string');
      expect((mod.buildVersion as string).length).toBeGreaterThan(0);
    });
  }
});

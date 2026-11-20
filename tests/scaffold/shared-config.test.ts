import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.restoreAllMocks());

describe('federation.shared', () => {
  // federation.shared.ts resolves package.json via process.cwd(), so run it as an app would.
  it('Q-shared-config: @mfe/ui is a non-singleton ^1, the four singletons stay singletons', async () => {
    vi.resetModules();
    vi.spyOn(process, 'cwd').mockReturnValue(resolve(import.meta.dirname, '../../apps/shell'));
    const { shared } = (await import('../../federation.shared.ts')) as {
      shared: Record<string, { singleton: boolean; requiredVersion: string }>;
    };
    expect(shared['@mfe/ui']?.singleton).toBe(false);
    expect(shared['@mfe/ui']?.requiredVersion.startsWith('^1')).toBe(true);
    for (const pkg of ['react', 'react-dom', 'react-router', '@mfe/auth-store']) {
      expect(shared[pkg]?.singleton, pkg).toBe(true);
    }
    expect(
      Object.keys(shared)
        .filter((k) => shared[k]?.singleton)
        .sort(),
    ).toEqual(['@mfe/auth-store', 'react', 'react-dom', 'react-router']);
  });
});

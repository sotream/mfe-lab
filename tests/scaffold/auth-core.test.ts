// Q-auth-core: the framework-free core has no react import; the hook lives in the ./react subpath.
// Reads the package through its public surface (package.json exports), not by file name.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = resolve(import.meta.dirname, '../../packages/auth-store');
const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')) as {
  exports: Record<string, string>;
};
const entry = (key: string) => resolve(dir, pkg.exports[key]!);
const imports = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(
    (m) => m[1]!,
  );

describe('auth-store split', () => {
  it('Q-auth-core: the main entry exports a ./react subpath', () => {
    expect(pkg.exports['./react']).toBeTypeOf('string');
    expect(pkg.exports['.']).toBeTypeOf('string');
    expect(entry('./react')).not.toBe(entry('.'));
  });

  it('Q-auth-core: the main entry and everything it imports locally has no react import', () => {
    const seen = new Set<string>();
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const spec of imports(file)) {
        expect(spec, `${file} imports ${spec}`).not.toMatch(/^react(-dom)?(\/|$)/);
        if (spec.startsWith('.')) {
          const target = resolve(dirname(file), spec);
          expect(target, `main entry must not pull in the react subpath`).not.toBe(
            entry('./react'),
          );
          walk(target);
        }
      }
    };
    walk(entry('.'));
  });

  it('Q-auth-core: react is no longer needed by the main entry at runtime', async () => {
    const core = await import('../../packages/auth-store/src/index.ts');
    expect(core).not.toHaveProperty('useAuth');
    for (const name of ['login', 'logout', 'getToken', 'subscribe']) {
      expect(core, name).toHaveProperty(name);
    }
  });

  it('Q-auth-core: the ./react subpath exports useAuth', async () => {
    const mod = (await import(entry('./react'))) as Record<string, unknown>;
    expect(mod.useAuth).toBeTypeOf('function');
  });
});

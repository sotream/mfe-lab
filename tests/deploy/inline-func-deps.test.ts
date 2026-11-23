// scripts/inline-func-deps.ts keeps pnpm's symlink layout in a prebuilt function (no install needed to deploy it).
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inlineFuncDeps } from '../../scripts/inline-func-deps.ts';

let tmp = '';
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('inlineFuncDeps', () => {
  it('recreates the listed symlinks relative, drops filePathMap, and fails on a missing source', () => {
    tmp = mkdtempSync(join(tmpdir(), 'inline-'));
    const root = join(tmp, 'root');
    const func = join(tmp, 'out/functions/api/index.func');
    // Repo checkout: apps/api/node_modules/pkg -> ../../../node_modules/.pnpm/pkg@1/node_modules/pkg
    mkdirSync(join(root, 'apps/api/node_modules'), { recursive: true });
    const link = '../../../node_modules/.pnpm/pkg@1/node_modules/pkg';
    symlinkSync(link, join(root, 'apps/api/node_modules/pkg'));
    // Function: the real files are already there, the symlink is not.
    mkdirSync(join(func, 'node_modules/.pnpm/pkg@1/node_modules/pkg'), { recursive: true });
    writeFileSync(join(func, 'node_modules/.pnpm/pkg@1/node_modules/pkg/index.js'), 'ok');
    const config = (map: Record<string, string>) =>
      writeFileSync(
        join(func, '.vc-config.json'),
        JSON.stringify({ handler: 'h', filePathMap: map }),
      );
    const key = 'apps/api/node_modules/pkg';
    config({ [key]: key });

    expect(inlineFuncDeps(join(tmp, 'out'), root)).toBe(1);
    expect(lstatSync(join(func, key)).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(func, key))).toBe(link);
    expect(readFileSync(join(func, key, 'index.js'), 'utf8')).toBe('ok');
    expect(JSON.parse(readFileSync(join(func, '.vc-config.json'), 'utf8'))).toEqual({
      handler: 'h',
    });

    config({ 'apps/api/node_modules/gone': 'apps/api/node_modules/gone' });
    expect(() => inlineFuncDeps(join(tmp, 'out'), root)).toThrow(/missing dependency/);
    expect(existsSync(join(func, 'apps/api/node_modules/gone'))).toBe(false);
  });
});

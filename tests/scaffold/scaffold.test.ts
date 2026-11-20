// Black-box tests for the T0 scaffold. Written from the plan Contract only:
// they inspect CLI output and resolved configs, never the builder's source files.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { getFileInfo, resolveConfig } from 'prettier';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const run = (cmd: string, args: string[]): string =>
  execFileSync(cmd, args, { cwd: root, encoding: 'utf8' });

const eslint = new ESLint({ cwd: root });
const lint = async (code: string, filePath: string) =>
  (await eslint.lintText(code, { filePath }))[0]?.messages ?? [];
const configFor = (filePath: string) => eslint.calculateConfigForFile(resolve(root, filePath));

const packages = [
  '@mfe/shell',
  '@mfe/products',
  '@mfe/dashboard',
  '@mfe/api',
  '@mfe/auth-store',
  '@mfe/ui',
  '@mfe/api-client', // added in T5
  '@mfe/events', // added in T17
];

describe('scaffold', { timeout: 60_000 }, () => {
  it('T-workspace: workspace has the eight packages and nothing else but the root', () => {
    const entries = JSON.parse(run('pnpm', ['-r', 'ls', '--depth', '-1', '--json'])) as {
      name: string;
      path: string;
    }[];
    const names = entries.map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(packages));
    const others = entries.filter((e) => !packages.includes(e.name));
    for (const e of others) expect(e.path).toBe(root);
  });

  it('T-engines: .nvmrc is 26 and Node major is >= 26', () => {
    expect(readFileSync(resolve(root, '.nvmrc'), 'utf8').trim()).toBe('26');
    expect(Number(process.versions.node.split('.')[0])).toBeGreaterThanOrEqual(26);
  });

  it('T-lint-any: explicit any is an error in .ts', async () => {
    const msgs = await lint('export const x: any = 1;\n', 'packages/ui/src/x.ts');
    expect(msgs).toContainEqual(
      expect.objectContaining({ ruleId: '@typescript-eslint/no-explicit-any', severity: 2 }),
    );
  });

  it('T-lint-any-tsx: explicit any is an error in .tsx', async () => {
    const msgs = await lint('export const x: any = 1;\n', 'apps/shell/src/x.tsx');
    expect(msgs).toContainEqual(
      expect.objectContaining({ ruleId: '@typescript-eslint/no-explicit-any', severity: 2 }),
    );
  });

  it('T-lint-unused: unused arg reported, _-prefixed arg ignored', async () => {
    const msgs = await lint(
      'export function f(_a: number, b: number): void {}\n',
      'packages/ui/src/x.ts',
    );
    const unused = msgs.filter((m) => m.ruleId === '@typescript-eslint/no-unused-vars');
    expect(unused).toHaveLength(1);
    expect(unused[0]?.severity).toBe(2);
    expect(unused[0]?.message).toMatch(/'b'/);
  });

  it('T-lint-hooks: conditional hook in shell .tsx is reported', async () => {
    const code = [
      "import { useState } from 'react';",
      'export function A({ on }: { on: boolean }) {',
      '  if (on) {',
      '    useState(0);',
      '  }',
      '  return null;',
      '}',
      '',
    ].join('\n');
    const msgs = await lint(code, 'apps/shell/src/a.tsx');
    expect(msgs).toContainEqual(
      expect.objectContaining({ ruleId: 'react-hooks/rules-of-hooks', severity: 2 }),
    );
  });

  it('T-lint-globals: window in frontend and process in api are defined', async () => {
    const win = await lint('export const y = window.x;\n', 'apps/shell/src/a.ts');
    expect(win.filter((m) => m.ruleId === 'no-undef')).toEqual([]);
    const proc = await lint('export const y = process.env;\n', 'apps/api/src/a.ts');
    expect(proc.filter((m) => m.ruleId === 'no-undef')).toEqual([]);

    const globalsOf = async (f: string) =>
      ((await configFor(f)) as { languageOptions?: { globals?: Record<string, unknown> } })
        .languageOptions?.globals ?? {};
    expect(await globalsOf('apps/shell/src/a.tsx')).toHaveProperty('window');
    expect(await globalsOf('apps/api/src/a.ts')).toHaveProperty('process');
    expect(await globalsOf('tests/scaffold/a.ts')).toHaveProperty('process');
  });

  it('T-lint-complexity: sonarjs cognitive-complexity is error at 10', async () => {
    const { rules } = (await configFor('apps/api/src/a.ts')) as { rules: Record<string, unknown> };
    expect([
      [2, 10],
      ['error', 10],
    ]).toContainEqual(rules['sonarjs/cognitive-complexity']);
  });

  it('T-prettier: shared options and ignore list', async () => {
    const cfg = await resolveConfig(resolve(root, 'apps/shell/src/a.ts'));
    expect(cfg).toMatchObject({ singleQuote: true, trailingComma: 'all', printWidth: 100 });
    const ignorePath = resolve(root, '.prettierignore');
    for (const f of ['pnpm-lock.yaml', 'dist/x.js']) {
      const info = await getFileInfo(resolve(root, f), { ignorePath });
      expect(info.ignored, f).toBe(true);
    }
  });

  it('T-tsconfig: strict options for shell and api', () => {
    const show = (p: string) =>
      (
        JSON.parse(run('pnpm', ['exec', 'tsc', '--showConfig', '-p', p])) as {
          compilerOptions: Record<string, unknown>;
        }
      ).compilerOptions;
    expect(show('apps/shell')).toMatchObject({
      strict: true,
      noUncheckedIndexedAccess: true,
      jsx: 'react-jsx',
    });
    expect(show('apps/api')).toMatchObject({ strict: true });
  });

  it('T-gitignore: secrets, db, deps and build output are ignored', () => {
    for (const f of ['.env', 'apps/api/data/app.db', 'node_modules/x', 'dist/x']) {
      expect(() => run('git', ['check-ignore', '-q', f]), f).not.toThrow();
    }
  });

  it('T-ci: workflow triggers, setup and step order', () => {
    const ci = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8');
    for (const s of ['push', 'main', 'pull_request', 'actions/setup-node']) {
      expect(ci).toContain(s);
    }
    expect(ci).toMatch(/node-version-file:\s*['"]?\.nvmrc/);
    expect(ci).toContain('pnpm install --frozen-lockfile');
    let at = -1;
    for (const step of ['pnpm lint', 'pnpm typecheck', 'pnpm test', 'pnpm build']) {
      const next = ci.indexOf(step, at + 1);
      expect(next, step).toBeGreaterThan(at);
      at = next;
    }
  });
});

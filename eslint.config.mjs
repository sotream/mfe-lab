import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

const frontend = [
  'apps/{shell,products,dashboard}/**/*.{ts,tsx}',
  'packages/{ui,auth-store}/**/*.{ts,tsx}',
];

// One root flat config for the whole monorepo.
export default defineConfig(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    plugins: { sonarjs },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'sonarjs/cognitive-complexity': ['error', 10],
    },
  },
  {
    files: frontend,
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['apps/api/**/*.ts', 'tests/**/*.ts', 'e2e/**/*.ts', 'scripts/*.{ts,mjs}', '*.{mjs,ts}'],
    languageOptions: { globals: globals.node },
  },
  prettier,
);

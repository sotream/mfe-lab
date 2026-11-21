import { defineConfig } from '@playwright/test';

// Runs against the dev servers. Servers already running locally are reused; in CI they are started.
const server = (command: string, url: string) => ({
  command,
  url,
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
});

// E2E_TARGET=docker runs the same specs against `docker compose up --build` (local only).
const docker = process.env.E2E_TARGET === 'docker';

export default defineConfig({
  testDir: 'e2e',
  ...(docker
    ? {}
    : { globalSetup: './e2e/global-setup.ts', globalTeardown: './e2e/global-teardown.ts' }),
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: docker
    ? {
        command: 'docker compose up --build',
        url: 'http://localhost:3000/inspector',
        timeout: 600_000,
        reuseExistingServer: false,
        // Default is SIGKILL, which leaves the containers running.
        gracefulShutdown: { signal: 'SIGTERM', timeout: 60_000 },
      }
    : [
        server(
          'pnpm --filter @mfe/api seed && pnpm --filter @mfe/api dev',
          'http://127.0.0.1:4000/health',
        ),
        server('pnpm --filter @mfe/products dev', 'http://localhost:3001/mf-manifest.json'),
        server('pnpm --filter @mfe/dashboard dev', 'http://localhost:3002/mf-manifest.json'),
        server('pnpm --filter @mfe/orders dev', 'http://localhost:3003/mf-manifest.json'),
        server('pnpm --filter @mfe/shell dev', 'http://localhost:3000'),
      ],
});

// Q-api-no-require-esm: regression for #46. Vercel's Node runtime may load the function with
// require() semantics where require(esm) is off; a static swagger-ui import then crashes with
// ERR_REQUIRE_ESM. Build the bundle, import it with require(esm) disabled, call the handler.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const apiDir = resolve(import.meta.dirname, '..');

// Runs inside `node --no-experimental-require-module`; prints the status of /cron/reseed.
const script = `
import { createServer } from 'node:http';
const { default: handler } = await import(${JSON.stringify(resolve(apiDir, 'api/index.js'))});
const server = createServer(handler);
server.listen(0, '127.0.0.1', async () => {
  const { port } = server.address();
  const r = await fetch('http://127.0.0.1:' + port + '/cron/reseed');
  console.log('STATUS ' + r.status);
  server.close();
  process.exit(0);
});
`;

describe('api function bundle', () => {
  it('Q-api-no-require-esm: loads without require(esm) and /cron/reseed answers 401', () => {
    execFileSync('pnpm', ['--filter', '@mfe/api', 'build'], { cwd: resolve(apiDir, '../..') });
    const out = execFileSync(
      'node',
      ['--no-experimental-require-module', '--input-type=module', '-e', script],
      {
        cwd: apiDir,
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x',
          JWT_SECRET: 'test-secret',
          CRON_SECRET: 'test-cron-secret',
        },
      },
    );
    expect(out).toContain('STATUS 401');
  }, 60_000);
});

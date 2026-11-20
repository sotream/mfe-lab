import { spawnSync } from 'node:child_process';

// Two frozen releases of products for the version-switching spec; removed by global-teardown.ts.
export default function globalSetup(): void {
  for (const v of ['0.0.1-e2e', '0.0.2-e2e']) {
    const r = spawnSync('pnpm', ['--filter', '@mfe/products', 'release', v], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`release ${v} failed`);
  }
}

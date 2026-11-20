import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const releases = join(import.meta.dirname, '..', 'apps', 'products', 'releases');
const fixtures = ['0.0.1-e2e', '0.0.2-e2e'];

export default function globalTeardown(): void {
  for (const v of fixtures) rmSync(join(releases, v), { recursive: true, force: true });
  const index = join(releases, 'index.json');
  if (!existsSync(index)) return;
  const { versions } = JSON.parse(readFileSync(index, 'utf8')) as { versions: string[] };
  const left = versions.filter((v) => !fixtures.includes(v));
  if (left.length) writeFileSync(index, `${JSON.stringify({ versions: left }, null, 2)}\n`);
  else rmSync(index);
}

// Usage (from an app dir, via its "release" script): node ../../scripts/release.ts <version>
// Freezes a build into releases/<version>/ and refreshes releases/index.json.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const version = process.argv[2] ?? '';
if (!/^[0-9A-Za-z.-]+$/.test(version)) {
  console.error(`invalid version "${version}": use only [0-9A-Za-z.-]`);
  process.exit(1);
}

const releases = join(process.cwd(), 'releases');
const dir = join(releases, version);
mkdirSync(dir, { recursive: true });
const build = spawnSync('pnpm', ['exec', 'rspack', 'build'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: { ...process.env, MF_BUILD_VERSION: version, MF_RELEASE_DIR: dir },
});
if (build.status !== 0) process.exit(build.status ?? 1);

const index = join(releases, 'index.json');
const known = existsSync(index)
  ? (JSON.parse(readFileSync(index, 'utf8')) as { versions: string[] }).versions
  : [];
const onDisk = readdirSync(releases, { withFileTypes: true }).filter((e) => e.isDirectory());
const semver = /^\d+\.\d+\.\d+$/;
const parts = (v: string) => v.split('.').map(Number);
const compare = (a: string, b: string) => {
  if (semver.test(a) && semver.test(b)) {
    const [pa, pb] = [parts(a), parts(b)];
    return pa[0]! - pb[0]! || pa[1]! - pb[1]! || pa[2]! - pb[2]!;
  }
  return a < b ? -1 : a > b ? 1 : 0;
};
const versions = [...new Set([...known, ...onDisk.map((e) => e.name), version])].sort(compare);
writeFileSync(index, `${JSON.stringify({ versions }, null, 2)}\n`);
console.log(`released ${version}: ${versions.join(', ')}`);

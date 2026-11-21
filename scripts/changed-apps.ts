// Maps changed file paths to the apps to deploy, in deploy order.
// CLI: git diff --name-only HEAD~1 HEAD | node scripts/changed-apps.ts   (prints one app per line)
export const APPS = ['api', 'products', 'dashboard', 'shell'] as const;
export type App = (typeof APPS)[number];

// Anything the four apps are built from: shared code, the lockfile, deploy config and this workflow.
const ALL_PREFIXES = ['packages/', 'deploy/'];
const ALL_FILES = new Set([
  'federation.shared.ts',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'package.json',
  'scripts/vercel-config.ts',
  '.github/workflows/deploy.yml',
]);

export function changedApps(files: string[]): App[] {
  const hit = new Set<string>();
  for (const f of files) {
    if (ALL_FILES.has(f) || ALL_PREFIXES.some((p) => f.startsWith(p))) return [...APPS];
    const m = /^apps\/([^/]+)\//.exec(f);
    if (m) hit.add(m[1]!);
  }
  return APPS.filter((a) => hit.has(a));
}

if (import.meta.main) {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c);
  const files = Buffer.concat(chunks).toString().split('\n').filter(Boolean);
  for (const app of changedApps(files)) console.log(app);
}

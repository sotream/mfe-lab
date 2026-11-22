// Maps changed file paths to the apps to deploy, in deploy order.
// CLI: git diff --name-only HEAD~1 HEAD | node scripts/changed-apps.ts   (prints one app per line)
//      ... | node scripts/changed-apps.ts --preview-needed   (prints true or false)
export const APPS = ['api', 'products', 'dashboard', 'orders', 'shell'] as const;
export type App = (typeof APPS)[number];

// Anything the five apps are built from: shared code, the lockfile, deploy config and this workflow.
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

// Test- and doc-only paths never need a deployed preview.
const NO_APP = [/^apps\/[^/]+\/test\//, /\.(test|spec)\./, /^(e2e|tests|docs)\//, /\.md$/];
// The preview pipeline itself: such a PR keeps a real preview so the pipeline stays tested.
const PIPELINE =
  /^(\.github\/workflows\/preview\.yml|scripts\/(preview-[^/]*\.ts|provision\.ts|vercel-config\.ts))$/;

export function previewNeeded(files: string[]): boolean {
  return (
    files.some((f) => PIPELINE.test(f)) ||
    changedApps(files.filter((f) => !NO_APP.some((re) => re.test(f)))).length > 0
  );
}

if (import.meta.main) {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c);
  const files = Buffer.concat(chunks).toString().split('\n').filter(Boolean);
  // --preview-needed prints true|false (the Preview workflow gates its deploy steps on it).
  if (process.argv[2] === '--preview-needed') console.log(previewNeeded(files));
  else for (const app of changedApps(files)) console.log(app);
}

// Makes `.vercel/output` deployable from a runner without `pnpm install`.
//   node scripts/inline-func-deps.ts [output dir, default .vercel/output]   (run from the repo root, after `vercel build`)
// `vercel build` lists a function's dependency symlinks in .vc-config.json `filePathMap` as paths in the
// checkout, and `vercel deploy --prebuilt` reads them from there (it fails when they are missing). This
// recreates each one inside the function, as the same relative symlink pnpm made, and drops the map. The real
// files are already in the function, so pnpm's layout (a package finds its own dependencies next to its real
// path) is kept. Symlinks do not survive upload-artifact: pack the output with tar. Plain fs, no dependencies.
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

const isLink = (p: string) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

export function inlineFuncDeps(output: string, root = process.cwd()): number {
  let copied = 0;
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && e.name.endsWith('.func')) inline(join(dir, e.name));
      else if (e.isDirectory()) walk(join(dir, e.name));
    }
  };
  const inline = (func: string) => {
    const file = join(func, '.vc-config.json');
    const config = JSON.parse(readFileSync(file, 'utf8')) as {
      filePathMap?: Record<string, string>;
    };
    for (const [dest, src] of Object.entries(config.filePathMap ?? {})) {
      const from = join(root, src);
      const to = join(func, dest);
      if (!existsSync(from) && !isLink(from)) throw new Error(`missing dependency: ${src}`);
      mkdirSync(dirname(to), { recursive: true });
      if (existsSync(to) || isLink(to)) continue;
      if (isLink(from)) symlinkSync(readlinkSync(from), to);
      else cpSync(from, to, { recursive: true, verbatimSymlinks: true });
      copied++;
    }
    delete config.filePathMap;
    writeFileSync(file, JSON.stringify(config, null, 2));
  };
  walk(join(output, 'functions'));
  return copied;
}

if (import.meta.main) {
  const dir = process.argv[2] ?? '.vercel/output';
  console.log(`inlined ${inlineFuncDeps(dir)} dependencies into ${dir}/functions`);
}

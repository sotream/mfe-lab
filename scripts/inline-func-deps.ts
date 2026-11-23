// Makes `.vercel/output` self-contained, so it can be deployed from a runner without `pnpm install`.
//   node scripts/inline-func-deps.ts [output dir, default .vercel/output]   (run from the repo root, after `vercel build`)
// `vercel build` lists a function's installed dependencies in .vc-config.json `filePathMap` as paths in the
// checkout; `vercel deploy --prebuilt` reads them from there and fails when they are missing. This copies each
// one into the function (symlinks resolved) and drops the map. Plain fs, no dependencies.
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
      if (!existsSync(join(root, src))) throw new Error(`missing dependency: ${src}`);
      cpSync(join(root, src), join(func, dest), { recursive: true, dereference: true });
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

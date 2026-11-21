import { defineConfig } from 'rolldown';

// Vercel cannot run our `.ts` import specifiers, so bundle the function entry to plain ESM.
// Packages stay external (Vercel installs and traces them).
export default defineConfig({
  input: 'src/vercel.ts',
  platform: 'node',
  external: [/^[^./]/],
  output: { file: 'api/index.js', format: 'esm' },
});

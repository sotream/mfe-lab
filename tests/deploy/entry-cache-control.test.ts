import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// T63: entry files are revalidated (ETag, 304), not no-store. Vercel side is covered in vercel-config.test.ts.
const root = join(import.meta.dirname, '../..');

describe('nginx entry cache', () => {
  it('Q-t63-nginx: manifest and remoteEntry location sends no-cache, never no-store', () => {
    const t = readFileSync(join(root, 'docker/nginx.conf.template'), 'utf8');
    const block = /location ~ \^\/\(mf-manifest[^{]*\{([^}]*)\}/.exec(t)?.[1] ?? '';
    expect(block).toMatch(/Cache-Control\s+no-cache\b/);
    expect(block).not.toMatch(/no-store/);
  });
});

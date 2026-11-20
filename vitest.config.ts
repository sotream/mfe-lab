import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __BUILD_VERSION__: JSON.stringify('test'),
    __MF_PRODUCTS_URL__: JSON.stringify('http://localhost:3001/mf-manifest.json'),
    __MF_DASHBOARD_URL__: JSON.stringify('http://localhost:3002/mf-manifest.json'),
  },
  test: {
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});

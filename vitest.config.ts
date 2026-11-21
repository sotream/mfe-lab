import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  define: {
    __BUILD_VERSION__: JSON.stringify('test'),
    __MF_PRODUCTS_URL__: JSON.stringify('http://localhost:3001/mf-manifest.json'),
    __MF_DASHBOARD_URL__: JSON.stringify('http://localhost:3002/mf-manifest.json'),
    __MF_ORDERS_URL__: JSON.stringify('http://localhost:3003/mf-manifest.json'),
  },
  test: {
    testTimeout: 30_000, // a fresh PGlite plus seed per test can pass 5 s under parallel load
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});

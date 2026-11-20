import { join } from 'node:path';
import { defineConfig } from '@rspack/cli';
import { rspack } from '@rspack/core';
import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack';
import { buildVersion, shared } from '../../federation.shared.ts';

export default defineConfig({
  entry: './src/index.ts',
  // MF_RELEASE_DIR is set by scripts/release.ts to freeze a build under releases/<version>/.
  output: { path: process.env.MF_RELEASE_DIR, publicPath: 'auto', clean: true },
  resolve: { extensions: ['.ts', '.tsx', '.js'] },
  experiments: { css: true },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        loader: 'builtin:swc-loader',
        options: {
          jsc: {
            parser: { syntax: 'typescript', tsx: true },
            transform: { react: { runtime: 'automatic' } },
          },
        },
      },
      { test: /\.css$/, type: 'css/auto' },
    ],
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'dashboard',
      filename: 'remoteEntry.js',
      exposes: { './DashboardPage': './src/DashboardPage.tsx' },
      shared,
      manifest: true,
      dts: false,
    }),
    new rspack.DefinePlugin({ __BUILD_VERSION__: JSON.stringify(buildVersion) }),
    new rspack.HtmlRspackPlugin({ template: './index.html' }),
  ],
  devServer: {
    port: 3002,
    headers: { 'Access-Control-Allow-Origin': '*' },
    // Frozen release builds, selectable from the shell inspector by manifest URL.
    static: { directory: join(import.meta.dirname, 'releases'), publicPath: '/releases' },
    historyApiFallback: true,
    // /api/* goes to the API with the prefix stripped: same origin for the browser, no CORS.
    proxy: [{ context: ['/api'], target: 'http://localhost:4000', pathRewrite: { '^/api': '' } }],
  },
});

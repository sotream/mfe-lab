import { join } from 'node:path';
import { defineConfig } from '@rspack/cli';
import { rspack } from '@rspack/core';
import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack';
import { exposesMap } from '../../federation.contract.ts';
import { buildVersion, shared } from '../../federation.shared.ts';

export default defineConfig({
  entry: './src/index.ts',
  // MF_RELEASE_DIR is set by scripts/release.ts to freeze a build under releases/<version>/.
  output: {
    path: process.env.MF_RELEASE_DIR,
    publicPath: 'auto',
    clean: true,
    // Content-hashed names: cacheable forever. remoteEntry.js keeps its fixed name (MF filename).
    filename: '[name].[contenthash:16].js',
    chunkFilename: '[name].[contenthash:16].js',
    cssFilename: '[name].[contenthash:16].css',
    cssChunkFilename: '[name].[contenthash:16].css',
    // The chunk registry is a page global, by default the same for every build of this remote. A
    // second release's remoteEntry would pick up the first release's same-id chunks from it and
    // run the old code. One global per version keeps releases apart.
    chunkLoadingGlobal: `rspackChunk_dashboard_${buildVersion}`,
  },
  resolve: { extensions: ['.ts', '.tsx', '.js'] },
  experiments: { css: true },
  // @mfe/ui's CSS (tokens, ds1, frame) came out twice, once per chunk group (provided shared module and
  // consumer): one named chunk. base.css stays out; the standalone bootstrap keeps it.
  optimization: {
    splitChunks: {
      cacheGroups: {
        uiCss: {
          test: /packages\/ui\/src\/(?!base\.css).*\.css$/,
          name: 'ui-css',
          chunks: 'all',
          enforce: true,
        },
      },
    },
  },
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
      { test: /\.woff2$/, type: 'asset/resource' },
    ],
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'dashboard',
      filename: 'remoteEntry.js',
      exposes: exposesMap('dashboard'),
      shared,
      manifest: true,
      dts: false,
    }),
    new rspack.DefinePlugin({ __BUILD_VERSION__: JSON.stringify(buildVersion) }),
    // Brand icons: unhashed, copied to the dist root.
    new rspack.CopyRspackPlugin({ patterns: [{ from: '../../packages/ui/brand' }] }),
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

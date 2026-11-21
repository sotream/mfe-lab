import { join } from 'node:path';
import { defineConfig } from '@rspack/cli';
import { rspack } from '@rspack/core';
import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack';
import { VueLoaderPlugin } from 'vue-loader';
import { exposesMap } from '../../federation.contract.ts';
import { buildVersion, shared } from '../../federation.shared.ts';

// The one Vue remote (RFC 0016). Vue is bundled here, not shared. Of the shared singletons only the
// framework-free @mfe/auth-store is used, so only it is declared (no react in this build).
export default defineConfig({
  entry: './src/index.ts',
  output: {
    path: process.env.MF_RELEASE_DIR,
    publicPath: 'auto',
    clean: true,
    // Content-hashed names: cacheable forever. remoteEntry.js keeps its fixed name (MF filename).
    filename: '[name].[contenthash:16].js',
    chunkFilename: '[name].[contenthash:16].js',
    cssFilename: '[name].[contenthash:16].css',
    cssChunkFilename: '[name].[contenthash:16].css',
    chunkLoadingGlobal: `rspackChunk_orders_${buildVersion}`,
  },
  resolve: { extensions: ['.ts', '.js', '.vue'] },
  experiments: { css: true },
  module: {
    rules: [
      { test: /\.vue$/, loader: 'vue-loader', options: { experimentalInlineMatchResource: true } },
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        loader: 'builtin:swc-loader',
        options: { jsc: { parser: { syntax: 'typescript' } } },
      },
      // The component styles are text injected into the shadow root; never a stylesheet in the page.
      { test: /\.css$/, resourceQuery: /raw/, type: 'asset/source' },
      { test: /\.css$/, resourceQuery: { not: [/raw/] }, type: 'css/auto' },
      { test: /\.woff2$/, type: 'asset/resource' },
    ],
  },
  plugins: [
    new VueLoaderPlugin(),
    new ModuleFederationPlugin({
      name: 'orders',
      filename: 'remoteEntry.js',
      exposes: exposesMap('orders'),
      shared: { '@mfe/auth-store': shared['@mfe/auth-store'] },
      manifest: true,
      dts: false,
    }),
    new rspack.DefinePlugin({
      __BUILD_VERSION__: JSON.stringify(buildVersion),
      __VUE_OPTIONS_API__: false,
      __VUE_PROD_DEVTOOLS__: false,
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
    }),
    new rspack.HtmlRspackPlugin({ template: './index.html' }),
  ],
  devServer: {
    port: 3003,
    headers: { 'Access-Control-Allow-Origin': '*' },
    // Frozen release builds are not supported for orders (RFC 0016); the path stays for symmetry.
    static: { directory: join(import.meta.dirname, 'releases'), publicPath: '/releases' },
    historyApiFallback: true,
    // /api/* goes to the API with the prefix stripped: same origin for the browser, no CORS.
    proxy: [{ context: ['/api'], target: 'http://localhost:4000', pathRewrite: { '^/api': '' } }],
  },
});

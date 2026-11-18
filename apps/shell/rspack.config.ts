import { defineConfig } from '@rspack/cli';
import { rspack } from '@rspack/core';
import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack';
import { shared } from '../../federation.shared.ts';

// Remote manifest URLs, overridable at build time (see src/remotes.ts).
const productsUrl = process.env.MF_PRODUCTS_URL ?? 'http://localhost:3001/mf-manifest.json';
const dashboardUrl = process.env.MF_DASHBOARD_URL ?? 'http://localhost:3002/mf-manifest.json';

export default defineConfig({
  entry: './src/index.ts',
  output: { publicPath: 'auto', clean: true },
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
    new ModuleFederationPlugin({ name: 'shell', shared, manifest: true, dts: false }),
    new rspack.DefinePlugin({
      __MF_PRODUCTS_URL__: JSON.stringify(productsUrl),
      __MF_DASHBOARD_URL__: JSON.stringify(dashboardUrl),
    }),
    new rspack.HtmlRspackPlugin({ template: './index.html', publicPath: '/' }),
  ],
  devServer: {
    port: 3000,
    historyApiFallback: true,
    // /api/* goes to the API with the prefix stripped: same origin for the browser, no CORS.
    proxy: [{ context: ['/api'], target: 'http://localhost:4000', pathRewrite: { '^/api': '' } }],
  },
});

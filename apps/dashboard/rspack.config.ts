import { defineConfig } from '@rspack/cli';
import { rspack } from '@rspack/core';
import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack';
import { shared } from '../../federation.shared.ts';

export default defineConfig({
  entry: './src/index.ts',
  output: { publicPath: 'auto', clean: true },
  resolve: { extensions: ['.ts', '.tsx', '.js'] },
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
    new rspack.HtmlRspackPlugin({ template: './index.html' }),
  ],
  devServer: {
    port: 3002,
    headers: { 'Access-Control-Allow-Origin': '*' },
    historyApiFallback: true,
  },
});

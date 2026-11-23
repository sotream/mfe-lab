import { defineConfig } from '@rspack/cli';
import { rspack } from '@rspack/core';
import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack';
import { buildVersion, shared } from '../../federation.shared.ts';

// Remote manifest URLs, overridable at build time (see src/remotes.ts).
const productsUrl = process.env.MF_PRODUCTS_URL ?? 'http://localhost:3001/mf-manifest.json';
const dashboardUrl = process.env.MF_DASHBOARD_URL ?? 'http://localhost:3002/mf-manifest.json';
const ordersUrl = process.env.MF_ORDERS_URL ?? 'http://localhost:3003/mf-manifest.json';

// Boot hints: the entry only loads the MF runtime, which then discovers the bootstrap chunk, the
// shared chunks the shell provides and the fonts one hop later. Name them in <head> from the build
// output (never hard-coded hashes). Remote and other async chunks are deliberately left out.
const bootPreload = {
  apply(compiler: import('@rspack/core').Compiler) {
    compiler.hooks.thisCompilation.tap('boot-preload', (compilation) => {
      compilation.hooks.processAssets.tap(
        { name: 'boot-preload', stage: rspack.Compilation.PROCESS_ASSETS_STAGE_REPORT },
        () => {
          const manifest = JSON.parse(
            String(compilation.getAsset('mf-manifest.json')?.source.source()),
          );
          const boot = compilation
            .getStats()
            .toJson({ all: false, chunks: true, chunkModules: true })
            .chunks?.find((c) => c.modules?.some((m) => m.name?.startsWith('./src/bootstrap.tsx')));
          const js = new Set<string>(boot?.files?.filter((f) => f.endsWith('.js')));
          for (const sh of manifest.shared) for (const f of sh.assets.js.sync) js.add(f);
          const fonts = Object.keys(compilation.assets)
            .filter((f) => f.endsWith('.woff2'))
            .slice(0, 2);
          const tags =
            [...js].map((f) => `<link rel="preload" as="script" href="/${f}">`).join('') +
            fonts
              .map(
                (f) => `<link rel="preload" as="font" type="font/woff2" href="/${f}" crossorigin>`,
              )
              .join('');
          const html = String(compilation.getAsset('index.html')!.source.source());
          compilation.updateAsset(
            'index.html',
            new rspack.sources.RawSource(html.replace('</head>', `${tags}</head>`)),
          );
        },
      );
    });
  },
};

export default defineConfig({
  entry: './src/index.ts',
  output: {
    publicPath: 'auto',
    clean: true,
    // Content-hashed names: cacheable forever. remoteEntry.js keeps its fixed name (MF filename).
    filename: '[name].[contenthash:16].js',
    chunkFilename: '[name].[contenthash:16].js',
    cssFilename: '[name].[contenthash:16].css',
    cssChunkFilename: '[name].[contenthash:16].css',
  },
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
      { test: /\.woff2$/, type: 'asset/resource' },
    ],
  },
  plugins: [
    new ModuleFederationPlugin({ name: 'shell', shared, manifest: true, dts: false }),
    new rspack.DefinePlugin({
      __BUILD_VERSION__: JSON.stringify(buildVersion),
      __PRODUCTION__: JSON.stringify(process.env.VERCEL_ENV === 'production'),
      __MF_PRODUCTS_URL__: JSON.stringify(productsUrl),
      __MF_DASHBOARD_URL__: JSON.stringify(dashboardUrl),
      __MF_ORDERS_URL__: JSON.stringify(ordersUrl),
    }),
    // Brand icons: unhashed, copied to the dist root.
    new rspack.CopyRspackPlugin({ patterns: [{ from: '../../packages/ui/brand' }] }),
    new rspack.HtmlRspackPlugin({ template: './index.html', publicPath: '/' }),
    bootPreload,
  ],
  devServer: {
    port: 3000,
    historyApiFallback: true,
    // /api/* goes to the API with the prefix stripped: same origin for the browser, no CORS.
    proxy: [{ context: ['/api'], target: 'http://localhost:4000', pathRewrite: { '^/api': '' } }],
  },
});

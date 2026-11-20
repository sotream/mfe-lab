import { createRequire } from 'node:module';

// The one shared-singleton list, imported by every rspack config (cwd = the app dir).
// MF cannot infer requiredVersion from `catalog:` specifiers, so it is read from the installed
// package instead; the pnpm catalog is the single place versions are pinned.
const require = createRequire(`${process.cwd()}/`);
const singleton = (pkg: string) => ({
  singleton: true,
  requiredVersion: `^${(require(`${pkg}/package.json`) as { version: string }).version}`,
});

export const shared = {
  react: singleton('react'),
  'react-dom': singleton('react-dom'),
  'react-router': singleton('react-router'),
  '@mfe/auth-store': singleton('@mfe/auth-store'),
};

// Build stamp: MF_BUILD_VERSION wins, else the current UTC time. Written back to the env so the
// MF manifest (metaData.buildInfo.buildVersion) carries the same value as __BUILD_VERSION__.
export const buildVersion =
  process.env.MF_BUILD_VERSION ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
process.env.MF_BUILD_VERSION = buildVersion;

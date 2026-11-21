import { createRequire } from 'node:module';

// The one shared-singleton list, imported by every rspack config (cwd = the app dir).
// MF cannot infer requiredVersion from `catalog:` specifiers, so it is read from the installed
// package instead; the pnpm catalog is the single place versions are pinned.
const require = createRequire(`${process.cwd()}/`);
// requiredVersion is read on first access, so a remote that shares only some of these (orders has
// no react installed, RFC 0016) can pick its entries without resolving the others.
const singleton = (pkg: string) => ({
  singleton: true,
  get requiredVersion() {
    return `^${(require(`${pkg}/package.json`) as { version: string }).version}`;
  },
});

export const shared = {
  react: singleton('react'),
  'react-dom': singleton('react-dom'),
  'react-router': singleton('react-router'),
  '@mfe/auth-store': singleton('@mfe/auth-store'),
  // Design system: not a singleton. Each remote may bring its own compatible 1.x copy; a breaking
  // change is a new major with a new CSS prefix, so two majors coexist (RFC 0008).
  '@mfe/ui': { singleton: false, requiredVersion: '^1.0.0' },
};

// Build stamp: MF_BUILD_VERSION wins, else the current UTC time. Written back to the env so the
// MF manifest (metaData.buildInfo.buildVersion) carries the same value as __BUILD_VERSION__.
export const buildVersion =
  process.env.MF_BUILD_VERSION ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
process.env.MF_BUILD_VERSION = buildVersion;

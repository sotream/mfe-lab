import { createRequire } from 'node:module';

// The one shared-singleton list, imported by every rspack config (cwd = the app dir).
// MF cannot infer requiredVersion from `catalog:` specifiers, so it is read from the installed
// package instead; the pnpm catalog is the single place versions are pinned.
// ponytail: add '@mfe/auth-store' here in T5 when it has content.
const require = createRequire(`${process.cwd()}/`);
const singleton = (pkg: string) => ({
  singleton: true,
  requiredVersion: `^${(require(`${pkg}/package.json`) as { version: string }).version}`,
});

export const shared = {
  react: singleton('react'),
  'react-dom': singleton('react-dom'),
  'react-router': singleton('react-router'),
};

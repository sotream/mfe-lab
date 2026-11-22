// The one canary allowlist (RFC 0017, Trust model). A canary manifest is code the shell executes for
// signed-in users, so only our own remote origins may serve one. Used by the API (PATCH /registry) and
// by the shell (resolveRemote, defence in depth). Plain TS, no imports beyond the URL list.
import urls from './urls.json' with { type: 'json' };

const PROD_ORIGINS = new Set([urls.products, urls.dashboard, urls.orders]);
// PR preview hosts (scripts/preview-urls.ts): exactly one app name and a number, nothing around it.
const PREVIEW_HOST = /^mfe-lab-(products|dashboard|orders)-pr-\d+\.vercel\.app$/;

// https, no user-info, a manifest path, an allowlisted origin. `allowLocal` (never in production)
// also accepts http://localhost:<port> for the local e2e releases.
export function isAllowedCanary(value: string, allowLocal: boolean): boolean {
  if (!URL.canParse(value)) return false;
  const u = new URL(value);
  if (u.username || u.password || !u.pathname.endsWith('/mf-manifest.json')) return false;
  if (u.protocol === 'https:') {
    return PROD_ORIGINS.has(u.origin) || (u.port === '' && PREVIEW_HOST.test(u.hostname));
  }
  return allowLocal && u.protocol === 'http:' && u.hostname === 'localhost' && u.port !== '';
}

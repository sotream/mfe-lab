import { report } from '@mfe/telemetry';
import type { ModuleFederationRuntimePlugin } from '@module-federation/enhanced/runtime';

// RFC 0017: a canary that fails at the manifest, the entry or the expose is swapped for stable.
// `fallBack(remote)` re-registers stable, marks the remote as fallen back and says whether it was
// on canary; false (stable already, manual pick, or fell back before) leaves the error alone, so
// there is at most one fallback per remote per page and a stable failure still shows the frame error.
export function fallbackPlugin(
  fallBack: (remote: string) => boolean,
): ModuleFederationRuntimePlugin {
  return {
    name: 'mfe-canary-fallback',
    async errorLoadRemote({ id, error, lifecycle, origin }) {
      // `onLoad` is the final failure of loadRemote; earlier lifecycles rethrow into it.
      if (lifecycle !== 'onLoad') return undefined;
      const remote = id.split('/')[0]!;
      if (!fallBack(remote)) return undefined;
      const reason = error instanceof Error ? error.message : String(error);
      report({
        remote,
        build: 'canary',
        kind: 'load',
        message: `canary failed, fell back to stable: ${reason}`.slice(0, 500),
      });
      return origin.loadRemote(id);
    },
  };
}

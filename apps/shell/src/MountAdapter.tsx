import { report } from '@mfe/telemetry';
import { currentLocale, type RemoteModule } from '@mfe/ui';
import { useEffect, useRef } from 'react';
import type { MountModule } from '../../../federation.contract.ts';

// Adapter for `mount`-kind remotes (RFC 0016): turns the module into the page module RemoteFrame
// expects, so the frame label, build stamp, Retry and error reporting work as for a React remote.
// The component mounts the remote into a host div and calls the returned unmount on cleanup.
// Locale: read when the effect runs, so a switch between render and mount is not missed; after that the
// remote follows `locale:changed` itself, so the effect must not depend on it (no remount).
export function mountAdapter(name: string, mod: MountModule): RemoteModule {
  function MountHost() {
    const host = useRef<HTMLDivElement>(null);
    useEffect(() => {
      // A synchronous throw here is caught by the frame's error boundary (error state + report).
      return mod.mount(host.current!, {
        locale: currentLocale(),
        onError: (error) => {
          const e = error instanceof Error ? error : new Error(String(error));
          report({
            remote: name,
            build: mod.buildVersion,
            kind: 'render',
            message: e.message,
            stack: e.stack,
          });
        },
      });
    }, []);
    return <div ref={host} />;
  }
  return { default: MountHost, buildVersion: mod.buildVersion };
}

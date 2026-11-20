import { installGlobalHandlers } from '@mfe/telemetry';
import '@mfe/ui/base.css';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { router } from './App.tsx';
import { startEventLog } from './eventLog.ts';
import { prefetchRemotes, remoteManifests } from './remotes.ts';
import './styles.css';

declare const __BUILD_VERSION__: string;

// Shell's own errors, then a catch-all for everything not from the shell or a remote (RFC 0010).
installGlobalHandlers({
  remote: 'shell',
  build: __BUILD_VERSION__,
  origin: location.origin,
});
installGlobalHandlers({
  remote: 'unknown',
  build: __BUILD_VERSION__,
  origin: null,
  ignoreOrigins: [location.origin, ...remoteManifests.map((r) => new URL(r.manifest).origin)],
});
startEventLog();
createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);

if ('requestIdleCallback' in window) requestIdleCallback(prefetchRemotes);
else setTimeout(prefetchRemotes, 200);

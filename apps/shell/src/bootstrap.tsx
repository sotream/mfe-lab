import { installGlobalHandlers } from '@mfe/telemetry';
import { detectLocale } from '@mfe/ui';
import '@mfe/ui/base.css';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { router } from './App.tsx';
import { startEventLog } from './eventLog.ts';
import { ensureRegistry, prefetchRemotes, remoteManifests } from './remotes.ts';
import './styles.css';

declare const __BUILD_VERSION__: string;

// Shell's own errors, then a catch-all for everything not from the shell or a remote (RFC 0010).
const remoteOrigins = remoteManifests.map((r) => new URL(r.manifest).origin);
installGlobalHandlers({
  remote: 'shell',
  build: __BUILD_VERSION__,
  origin: location.origin,
  ignoreOrigins: remoteOrigins,
});
installGlobalHandlers({
  remote: 'unknown',
  build: __BUILD_VERSION__,
  origin: null,
  ignoreOrigins: [location.origin, ...remoteOrigins],
});
document.documentElement.lang = detectLocale();
startEventLog();
void ensureRegistry(); // in parallel with the render; remotes wait for it, at most 2 s
createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);

if ('requestIdleCallback' in window) requestIdleCallback(() => void prefetchRemotes());
else setTimeout(() => void prefetchRemotes(), 200);

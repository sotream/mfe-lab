import { installGlobalHandlers } from '@mfe/telemetry';

declare const __BUILD_VERSION__: string;
declare const __webpack_public_path__: string | undefined;

// publicPath is 'auto': the URL this remote was loaded from, so its origin is the remote's own
// (standalone: the page origin). Resolved against location for a relative path.
const base = typeof __webpack_public_path__ === 'string' ? __webpack_public_path__ : '';

// Imported by the exposed page: runs once per bundle (RFC 0010).
installGlobalHandlers({
  remote: 'products',
  build: __BUILD_VERSION__,
  origin: new URL(base, location.href).origin,
});

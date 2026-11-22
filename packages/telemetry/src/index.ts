// Error reporting to POST /api/errors (RFC 0010). Not a federation singleton: each remote bundles
// its own copy; the de-dupe map and the installed-handler registry are per bundle.
export type ErrorKind = 'render' | 'load' | 'unhandled';
export type ErrorReport = {
  remote: string;
  build: string;
  kind: ErrorKind;
  message: string;
  stack?: string;
};

const URL_PATH = '/api/errors';
const DEDUPE_MS = 5000;
const lastSent = new Map<string, number>();

// Never throws. Same remote + kind + message within 5 s is sent once.
export function report(e: ErrorReport): void {
  try {
    const key = `${e.remote}|${e.kind}|${e.message}`;
    const now = Date.now();
    const prev = lastSent.get(key);
    if (prev !== undefined && now - prev < DEDUPE_MS) return;
    lastSent.set(key, now);

    // Cut to the API's limits (a longer value would be rejected, losing the report).
    const json = JSON.stringify({
      ...e,
      message: e.message.slice(0, 2000),
      stack: e.stack?.slice(0, 8000),
      url: location.href.slice(0, 2000),
    });
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.sendBeacon === 'function' &&
      navigator.sendBeacon(URL_PATH, new Blob([json], { type: 'application/json' }))
    ) {
      return;
    }
    fetch(URL_PATH, {
      method: 'POST',
      body: json,
      keepalive: true,
      headers: { 'content-type': 'application/json' },
    }).catch(() => {});
  } catch {
    // reporting must never break the page
  }
}

type Options = {
  remote: string;
  build: string;
  // A string: report only errors from that origin. null: catch-all for errors matching none of
  // ignoreOrigins.
  origin: string | null;
  ignoreOrigins?: string[];
};

const installed = new Map<string, () => void>();

export function installGlobalHandlers(opts: Options): () => void {
  const existing = installed.get(opts.remote);
  if (existing) return existing;

  const handle = (message: string, filename: string, stack: string) => {
    const from = (o: string) => filename.startsWith(o) || stack.includes(o);
    const mine = opts.origin === null ? !(opts.ignoreOrigins ?? []).some(from) : from(opts.origin);
    if (mine)
      report({
        remote: opts.remote,
        build: opts.build,
        kind: 'unhandled',
        message,
        stack: stack || undefined,
      });
  };
  const onError = (e: ErrorEvent) =>
    handle(e.message, e.filename ?? '', (e.error as Error | undefined)?.stack ?? '');
  const onRejection = (e: PromiseRejectionEvent) => {
    const r = e.reason as { message?: unknown; stack?: unknown } | null | undefined;
    handle(String(r?.message ?? e.reason), '', typeof r?.stack === 'string' ? r.stack : '');
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  const uninstall = () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    installed.delete(opts.remote);
  };
  installed.set(opts.remote, uninstall);
  return uninstall;
}

/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type NodeProc = {
  on(e: string, f: () => void): void;
  off(e: string, f: () => void): void;
};
type Mod = typeof import('../src/index.ts');
const fresh = async (): Promise<Mod> => {
  vi.resetModules();
  return import('../src/index.ts');
};
const ev = (message = 'boom') =>
  ({ remote: 'products', build: 'b1', kind: 'render', message }) as const;

const fetchMock = () => {
  const f = vi.fn(async () => new Response(null, { status: 201 }));
  vi.stubGlobal('fetch', f);
  return f;
};
const setBeacon = (impl: ((url: string, data: Blob) => boolean) | undefined) =>
  Object.defineProperty(navigator, 'sendBeacon', { value: impl, configurable: true });
const readBlob = (b: Blob) =>
  new Promise<string>((res) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.readAsText(b);
  });
const sent = (f: ReturnType<typeof fetchMock>) =>
  (f.mock.calls as unknown as [string, RequestInit][]).map(([, init]) =>
    JSON.parse(String(init.body)),
  );
const dispatch = (filename?: string, message = 'x') =>
  window.dispatchEvent(new ErrorEvent('error', { message, filename }));

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  setBeacon(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('report', () => {
  it('Q-telemetry: uses sendBeacon when available, not fetch', async () => {
    const { report } = await fresh();
    const f = fetchMock();
    const beacon = vi.fn((_url: string, _data: Blob) => true);
    setBeacon(beacon);
    report(ev());
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0]![0]).toBe('/api/errors');
    const blob = beacon.mock.calls[0]![1];
    expect(blob.type).toBe('application/json');
    expect(JSON.parse(await readBlob(blob))).toMatchObject({
      remote: 'products',
      build: 'b1',
      kind: 'render',
      message: 'boom',
      url: location.href,
    });
    expect(f).not.toHaveBeenCalled();
  });

  it('Q-telemetry: without sendBeacon falls back to fetch with keepalive', async () => {
    const { report } = await fresh();
    const f = fetchMock();
    report(ev());
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/errors');
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init.body))).toMatchObject({ remote: 'products', url: location.href });
  });

  it('Q-telemetry: a rejecting fetch neither throws nor leaves an unhandled rejection', async () => {
    const { report } = await fresh();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
    const unhandled = vi.fn();
    const proc = (globalThis as unknown as { process: NodeProc }).process;
    proc.on('unhandledRejection', unhandled);
    try {
      expect(() => report(ev())).not.toThrow();
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      proc.off('unhandledRejection', unhandled);
    }
  });

  it('Q-telemetry: a throwing sendBeacon does not throw', async () => {
    const { report } = await fresh();
    fetchMock();
    setBeacon(() => {
      throw new Error('nope');
    });
    expect(() => report(ev())).not.toThrow();
  });

  it('Q-telemetry: de-dupes the same remote+kind+message within 5 s', async () => {
    vi.useFakeTimers();
    const { report } = await fresh();
    const f = fetchMock();
    report(ev('same'));
    report(ev('same'));
    expect(f).toHaveBeenCalledTimes(1);
    report(ev('other'));
    expect(f).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5001);
    report(ev('same'));
    expect(f).toHaveBeenCalledTimes(3);
  });
});

describe('installGlobalHandlers', () => {
  it('Q-telemetry: origin filter reports only matching filenames', async () => {
    const { installGlobalHandlers } = await fresh();
    const f = fetchMock();
    const off1 = installGlobalHandlers({
      remote: 'products',
      build: 'bp',
      origin: 'http://localhost:3001',
    });
    const off2 = installGlobalHandlers({
      remote: 'dashboard',
      build: 'bd',
      origin: 'http://localhost:3002',
    });
    dispatch('http://localhost:3001/x.js', 'from products');
    expect(sent(f)).toHaveLength(1);
    expect(sent(f)[0]).toMatchObject({
      remote: 'products',
      build: 'bp',
      kind: 'unhandled',
      message: 'from products',
    });
    off1();
    off2();
  });

  it('Q-telemetry: matches by stack origin when filename is empty', async () => {
    const { installGlobalHandlers } = await fresh();
    const f = fetchMock();
    const off = installGlobalHandlers({
      remote: 'products',
      build: 'bp',
      origin: 'http://localhost:3001',
    });
    const error = new Error('deep');
    error.stack = 'Error: deep\n    at fn (http://localhost:3001/chunk.js:1:1)';
    window.dispatchEvent(new ErrorEvent('error', { message: 'deep', error }));
    expect(sent(f)).toHaveLength(1);
    off();
  });

  it('Q-telemetry: catch-all (origin null) reports unmatched events as the given remote', async () => {
    const { installGlobalHandlers } = await fresh();
    const f = fetchMock();
    const off = installGlobalHandlers({
      remote: 'unknown',
      build: 'bs',
      origin: null,
      ignoreOrigins: ['http://localhost:3001', 'http://localhost:3000'],
    });
    dispatch(undefined, 'Script error.');
    expect(sent(f)).toHaveLength(1);
    expect(sent(f)[0]).toMatchObject({ remote: 'unknown', kind: 'unhandled' });
    dispatch('http://localhost:3001/x.js', 'ignored remote');
    dispatch('http://localhost:3000/main.js', 'ignored shell');
    expect(sent(f)).toHaveLength(1);
    dispatch('http://elsewhere.test/a.js', 'foreign');
    expect(sent(f)).toHaveLength(2);
    off();
  });

  it('Q-telemetry: unhandledrejection is reported when the stack matches the origin', async () => {
    const { installGlobalHandlers } = await fresh();
    const f = fetchMock();
    const off = installGlobalHandlers({
      remote: 'products',
      build: 'bp',
      origin: 'http://localhost:3001',
    });
    const reason = new Error('rejected');
    reason.stack = 'Error: rejected\n    at http://localhost:3001/a.js:1:1';
    const e = Object.assign(new Event('unhandledrejection'), { reason });
    window.dispatchEvent(e);
    expect(sent(f)).toHaveLength(1);
    expect(sent(f)[0]).toMatchObject({ remote: 'products', kind: 'unhandled' });
    off();
  });

  it('Q-telemetry: idempotent per remote name; uninstall stops reporting', async () => {
    const { installGlobalHandlers } = await fresh();
    const f = fetchMock();
    const opts = { remote: 'products', build: 'bp', origin: 'http://localhost:3001' };
    const off = installGlobalHandlers(opts);
    installGlobalHandlers(opts);
    dispatch('http://localhost:3001/x.js', 'once');
    expect(f).toHaveBeenCalledTimes(1);
    off();
    dispatch('http://localhost:3001/x.js', 'after off');
    expect(f).toHaveBeenCalledTimes(1);
  });
});

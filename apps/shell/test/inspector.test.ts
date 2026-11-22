import { afterEach, describe, expect, it, vi } from 'vitest';
import { pingRemote, sharedRows, type ShareScope } from '../src/inspector.ts';

const URL_ = 'http://localhost:3001/mf-manifest.json';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const stub = (impl: () => Promise<Response>) => {
  const fetch = vi.fn(impl);
  vi.stubGlobal('fetch', fetch);
  return fetch;
};
const down = { status: 'down', version: null };

afterEach(() => void vi.unstubAllGlobals());

describe('pingRemote', () => {
  it('Q-ping-up: 200 JSON gives up with the build version', async () => {
    stub(() => Promise.resolve(json(200, { metaData: { buildInfo: { buildVersion: 'v9' } } })));
    expect(await pingRemote(URL_)).toEqual({ status: 'up', version: 'v9' });
  });

  it('Q-ping-noversion: 200 without buildInfo gives up with null', async () => {
    stub(() => Promise.resolve(json(200, { metaData: {} })));
    expect(await pingRemote(URL_)).toEqual({ status: 'up', version: null });
    stub(() => Promise.resolve(json(200, {})));
    expect(await pingRemote(URL_)).toEqual({ status: 'up', version: null });
  });

  it('Q-ping-down: 500, network error and invalid JSON give down and never reject', async () => {
    stub(() => Promise.resolve(json(500, { metaData: { buildInfo: { buildVersion: 'x' } } })));
    expect(await pingRemote(URL_)).toEqual(down);
    stub(() => Promise.reject(new Error('network')));
    expect(await pingRemote(URL_)).toEqual(down);
    stub(() => Promise.resolve(new Response('<html>', { status: 200 })));
    expect(await pingRemote(URL_)).toEqual(down);
  });

  it('Q-ping-nostore: fetch gets the URL and cache no-store', async () => {
    const fetch = stub(() => Promise.resolve(json(200, {})));
    await pingRemote(URL_);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]).toEqual([URL_, expect.objectContaining({ cache: 'no-store' })]);
  });
});

describe('sharedRows', () => {
  it('Q-shared-rows: undefined gives an empty list', () => {
    expect(sharedRows(undefined)).toEqual([]);
  });

  it('Q-shared-rows: one row per package sorted by name, with sorted versions', () => {
    const scope: ShareScope = {
      react: {
        '19.1.0': {
          from: 'shell',
          loaded: true,
          shareConfig: { singleton: true, requiredVersion: '^19.0.0' },
        },
        '18.3.0': { from: 'products', loaded: true, shareConfig: { requiredVersion: '^18.0.0' } },
        '17.0.0': { from: 'dashboard', shareConfig: { requiredVersion: '^17.0.0' } },
      },
      'a-lib': { '1.0.0': { from: 'products', shareConfig: { requiredVersion: '^1.0.0' } } },
      'z-lib': {
        '2.0.0': { from: 'shell', loaded: true, shareConfig: { requiredVersion: false } },
      },
    };
    const rows = sharedRows(scope);
    expect(rows.map((r) => r.name)).toEqual(['a-lib', 'react', 'z-lib']);
    const [a, react, z] = rows;
    expect(react).toMatchObject({
      required: '^19.0.0',
      versions: ['17.0.0', '18.3.0', '19.1.0'],
      loaded: ['18.3.0', '19.1.0'],
      singleton: true,
    });
    expect(a).toMatchObject({ loaded: [], singleton: false });
    expect(z).toMatchObject({ required: '—', loaded: ['2.0.0'] });
  });

  it('Q-shared-rows: required falls back to the first entry when none is from shell', () => {
    const rows = sharedRows({
      lib: { '1.0.0': { from: 'products', shareConfig: { requiredVersion: '^1.0.0' } } },
    });
    expect(rows[0]?.required).toBe('^1.0.0');
  });

  it('Q-shared-rows: required is a dash when there is no shareConfig', () => {
    expect(sharedRows({ lib: { '1.0.0': { from: 'shell' } } })[0]?.required).toBe('—');
  });

  it('Q-shared-rows: numeric truthy singleton counts as singleton', () => {
    const rows = sharedRows({
      lib: { '1.0.0': { from: 'shell', shareConfig: { singleton: 1 } } },
    });
    expect(rows[0]?.singleton).toBe(true);
  });
});

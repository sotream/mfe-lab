// Q-origin. ASSUMPTION: `remoteOrigin(manifestUrl: string): string` is exported from ../src/remotes.ts
// (phase 2 adjusts the import to the builder's real name and location).
import { describe, expect, it, vi } from 'vitest';

vi.mock('@module-federation/enhanced/runtime', () => ({
  getInstance: () => null,
  registerPlugins: vi.fn(),
  init: vi.fn(),
  registerRemotes: vi.fn(),
  loadRemote: vi.fn(),
}));

import { remoteOrigin } from '../src/remotes.ts';

describe('remoteOrigin', () => {
  it.each([
    ['http://localhost:3001/mf-manifest.json', ':3001'],
    ['http://127.0.0.1:3002/x/mf-manifest.json', ':3002'],
    ['https://mfe-lab-products.vercel.app/mf-manifest.json', 'mfe-lab-products'],
    ['https://mfe-lab-products.vercel.app/releases/1.2.0/mf-manifest.json', 'mfe-lab-products'],
  ])('Q-origin: %s gives %s', (url, expected) => {
    expect(remoteOrigin(url)).toBe(expected);
  });
});

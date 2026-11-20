import { beforeEach, describe, expect, it, vi } from 'vitest';

const rt = vi.hoisted(() => ({
  registerRemotes: vi.fn(),
  loadRemote: vi.fn(),
  init: vi.fn(),
}));
vi.mock('@module-federation/enhanced/runtime', () => ({
  getInstance: () => null,
  init: rt.init,
  registerRemotes: rt.registerRemotes,
  loadRemote: rt.loadRemote,
}));

import { loadPage, setRemoteEntry } from '../src/remotes.ts';

beforeEach(() => {
  setRemoteEntry('products', null);
  vi.clearAllMocks();
  rt.loadRemote.mockResolvedValue({ default: () => null });
});

describe('loadPage module argument', () => {
  it('Q-load-module: explicit module and default', async () => {
    await loadPage('products', 'ProductsApp');
    expect(rt.loadRemote).toHaveBeenLastCalledWith('products/ProductsApp');
    await loadPage('products');
    expect(rt.loadRemote).toHaveBeenLastCalledWith('products/ProductsPage');
  });
});

/** @vitest-environment jsdom */
// Q-surfaces (inspector). While every request is pending the async tables are busy skeletons.
import { login, logout } from '@mfe/auth-store';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@module-federation/enhanced/runtime', () => ({
  getInstance: () => null,
  registerPlugins: vi.fn(),
  init: vi.fn(),
  registerRemotes: vi.fn(),
  loadRemote: vi.fn(),
}));

import InspectorPage from '../src/InspectorPage.tsx';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  cleanup();
  logout();
  vi.unstubAllGlobals();
});

describe('inspector loading state', () => {
  it('Q-surfaces: flags and errors are busy skeletons, remotes stay real rows while pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url === '/api/auth/login'
          ? Promise.resolve(
              json(200, { token: 't', user: { id: 1, email: 'admin@lab.test', role: 'admin' } }),
            )
          : new Promise<Response>(() => {}),
      ),
    );
    await act(() => login('admin@lab.test', 'lab12345'));
    await act(async () => {
      render(<InspectorPage />);
      await new Promise((r) => setTimeout(r, 0));
    });
    for (const [name, rows] of [
      ['Flags', 3],
      ['Errors', 1],
    ] as const) {
      const table = screen.getByRole('table', { name });
      expect(table.getAttribute('aria-busy'), name).toBe('true');
      expect(table.querySelectorAll('tbody tr[aria-hidden="true"]'), name).toHaveLength(rows);
    }
    // the Remotes table keeps real rows while the manifests are pinged
    const remotes = screen.getByRole('table', { name: 'Remotes' });
    expect(remotes.hasAttribute('aria-busy')).toBe(false);
    expect(remotes.querySelectorAll('tbody tr[aria-hidden="true"]')).toHaveLength(0);
    expect(remotes.querySelectorAll('tbody tr').length).toBeGreaterThanOrEqual(3);
  });
});

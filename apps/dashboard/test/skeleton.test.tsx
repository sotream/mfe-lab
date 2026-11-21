/** @vitest-environment jsdom */
// Q-surfaces (dashboard). ASSUMPTION: tiles render as dl > div > dt/dd with a skeleton in the dd while pending.
import { login, logout } from '@mfe/auth-store';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from '../src/DashboardPage.tsx';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  cleanup();
  logout();
  vi.unstubAllGlobals();
});

describe('dashboard loading state', () => {
  it('Q-surfaces: pending stats show 4 reading tiles with skeletons and a status text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url === '/api/auth/login'
          ? Promise.resolve(
              json(200, { token: 't', user: { id: 3, email: 'viewer@lab.test', role: 'viewer' } }),
            )
          : new Promise<Response>(() => {}),
      ),
    );
    await act(() => login('viewer@lab.test', 'lab12345'));
    await act(async () => {
      render(
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>,
      );
      await new Promise((r) => setTimeout(r, 0));
    });
    const tiles = document.querySelectorAll('dl.ds1-readings dd');
    expect(tiles).toHaveLength(4);
    for (const dd of tiles) expect(dd.querySelector('.ds1-skeleton')).not.toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Loading dashboard');
    expect(document.querySelectorAll('.ds1-skeleton').length).toBeGreaterThan(4); // chart + status bars too
  });
});

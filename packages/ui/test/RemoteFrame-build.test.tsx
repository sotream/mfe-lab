/** @vitest-environment jsdom */
import { act, cleanup, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteFrame, type RemoteModule } from '../src/index.ts';

const Ok = () => <p>remote ok</p>;
const mount = (ui: ReactElement) => act(async () => void render(ui));
const frame = (load: () => Promise<RemoteModule>) => (
  <RemoteFrame name="products" port={3001} load={load} />
);

describe('RemoteFrame build stamp', () => {
  beforeEach(() => void vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('Q-frame-build: loaded module with buildVersion shows "build v1" inside the section', async () => {
    await mount(frame(() => Promise.resolve({ default: Ok, buildVersion: 'v1' })));
    const section = screen.getByRole('region', { name: 'products remote' });
    const el = await within(section).findByText('build v1');
    expect(el.classList.contains('remote-frame-build')).toBe(true);
    expect(within(section).getByText('products · :3001')).toBeTruthy();
  });

  it('Q-frame-build: no buildVersion means no build text', async () => {
    await mount(frame(() => Promise.resolve({ default: Ok })));
    await screen.findByText('remote ok');
    expect(screen.queryByText(/^build /)).toBeNull();
  });

  it('Q-frame-build: no build text while loading', () => {
    render(frame(() => new Promise(() => {})));
    expect(screen.queryByText(/^build /)).toBeNull();
  });

  it('Q-frame-build: no build text after a failure', async () => {
    await mount(frame(() => Promise.reject(new Error('down'))));
    await screen.findByRole('alert');
    expect(screen.queryByText(/^build /)).toBeNull();
  });
});

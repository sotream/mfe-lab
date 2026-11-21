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
    expect(within(section).getByText('products')).toBeTruthy();
    expect(within(section).getByText(':3001')).toBeTruthy();
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

  it('Q-frame-build: an ISO timestamp renders as a compact stamp with full time attributes', async () => {
    const iso = '2026-11-21T19:39:52Z';
    await mount(frame(() => Promise.resolve({ default: Ok, buildVersion: iso })));
    const el = await screen.findByText('21.11 19:39Z');
    expect(el.closest('.remote-frame-build')?.textContent).toBe('build 21.11 19:39Z');
    expect(el.tagName).toBe('TIME');
    expect(el.getAttribute('datetime')).toBe(iso);
    expect(el.getAttribute('title')).toBe(iso);
  });

  it('Q-frame-build: a release version stays unchanged and is not a time element', async () => {
    await mount(frame(() => Promise.resolve({ default: Ok, buildVersion: '0.0.2-e2e' })));
    const el = await screen.findByText('build 0.0.2-e2e');
    expect(el.querySelector('time')).toBeNull();
  });

  it('Q-frame-origin: originTitle becomes the title of the origin label', async () => {
    await mount(
      <RemoteFrame
        name="products"
        origin="mfe-lab-products"
        originTitle="mfe-lab-products.vercel.app"
        load={() => Promise.resolve({ default: Ok })}
      />,
    );
    expect(screen.getByText('mfe-lab-products').getAttribute('title')).toBe(
      'mfe-lab-products.vercel.app',
    );
  });

  it('Q-frame-origin: without originTitle the origin label has no title', async () => {
    await mount(frame(() => Promise.resolve({ default: Ok })));
    expect(screen.getByText(':3001').hasAttribute('title')).toBe(false);
  });
});

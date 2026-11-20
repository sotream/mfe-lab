/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteFrame, type RemoteModule } from '../src/index.ts';

const Ok = () => <p>remote ok</p>;
const Boom = (): never => {
  throw new Error('boom');
};
const loader = () => vi.fn<() => Promise<RemoteModule>>();
const fail = () => Promise.reject(new Error('remote down'));

// React 19 + RTL: Suspense pings outside act() are never flushed, so render and click inside an
// awaited act(). Plain render is kept only for Q-pending, which asserts the synchronous state.
const mount = (ui: ReactElement) => act(async () => void render(ui));
const click = (el: HTMLElement) => act(async () => void fireEvent.click(el));

const findAlert = async (name: string) => {
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByText(new RegExp(`${name} is unavailable`))).toBeTruthy();
  expect(within(alert).getByRole('button', { name: 'Retry' })).toBeTruthy();
  return alert;
};

describe('RemoteFrame', () => {
  // React logs errors caught by error boundaries; keep test output readable.
  beforeEach(() => void vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('Q-frame: section with data-remote, accessible name and port label', async () => {
    await mount(
      <RemoteFrame name="products" port={3001} load={() => Promise.resolve({ default: Ok })} />,
    );
    const section = screen.getByRole('region', { name: 'products remote' });
    expect(section.tagName).toBe('SECTION');
    expect(section.getAttribute('data-remote')).toBe('products');
    expect(within(section).getByText('products')).toBeTruthy();
    expect(within(section).getByText(':3001')).toBeTruthy();
    await screen.findByText('remote ok');
  });

  it('Q-pending: never-resolving loader shows loading status', () => {
    render(<RemoteFrame name="products" port={3001} load={() => new Promise(() => {})} />);
    expect(screen.getByRole('status').textContent).toContain('Loading products…');
  });

  it('Q-resolved: default component renders and status is gone', async () => {
    await mount(
      <RemoteFrame name="products" port={3001} load={() => Promise.resolve({ default: Ok })} />,
    );
    const section = screen.getByRole('region', { name: 'products remote' });
    expect(await within(section).findByText('remote ok')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('Q-reject: rejected load shows alert with Retry', async () => {
    await mount(<RemoteFrame name="products" port={3001} load={fail} />);
    await findAlert('products');
  });

  it('Q-throw: component throwing during render shows the same alert', async () => {
    await mount(
      <RemoteFrame name="products" port={3001} load={() => Promise.resolve({ default: Boom })} />,
    );
    await findAlert('products');
  });

  it('Q-retry: Retry calls load once more and renders on success', async () => {
    const load = loader()
      .mockRejectedValueOnce(new Error('remote down'))
      .mockResolvedValueOnce({ default: Ok });
    await mount(<RemoteFrame name="products" port={3001} load={load} />);
    const alert = await findAlert('products');
    expect(load).toHaveBeenCalledTimes(1);

    await click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('remote ok')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('Q-retry-fail-again: second failure shows the alert again', async () => {
    const load = loader().mockImplementation(fail);
    await mount(<RemoteFrame name="products" port={3001} load={load} />);
    const first = await findAlert('products');

    await click(within(first).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await findAlert('products');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('Q-isolation: a failed frame does not break its sibling', async () => {
    await mount(
      <>
        <RemoteFrame name="products" port={3001} load={fail} />
        <RemoteFrame
          name="dashboard"
          port={3002}
          load={() => Promise.resolve({ default: () => <p>dashboard ok</p> })}
        />
      </>,
    );
    const products = screen.getByRole('region', { name: 'products remote' });
    const dashboard = screen.getByRole('region', { name: 'dashboard remote' });
    expect(await within(products).findByRole('alert')).toBeTruthy();
    expect(within(products).getByText(/products is unavailable/)).toBeTruthy();
    expect(await within(dashboard).findByText('dashboard ok')).toBeTruthy();
    expect(within(dashboard).queryByRole('alert')).toBeNull();
  });
});

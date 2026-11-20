/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteFrame } from '../src/index.ts';

const Boom = (): never => {
  throw new Error('kaboom');
};
const mount = (ui: React.ReactElement) => act(async () => void render(ui));

describe('RemoteFrame report', () => {
  beforeEach(() => void vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('Q-remoteframe-report: a load rejection reports kind load', async () => {
    const report = vi.fn();
    await mount(
      <RemoteFrame
        name="products"
        port={3001}
        report={report}
        load={() => Promise.reject(new Error('remote down'))}
      />,
    );
    await screen.findByRole('alert');
    expect(report).toHaveBeenCalled();
    expect(report.mock.calls[0]![0]).toMatchObject({
      remote: 'products',
      kind: 'load',
      build: 'unknown',
    });
    expect(String(report.mock.calls[0]![0].message)).toContain('remote down');
  });

  it('Q-remoteframe-report: a render error reports kind render with the module buildVersion', async () => {
    const report = vi.fn();
    await mount(
      <RemoteFrame
        name="products"
        port={3001}
        report={report}
        load={() => Promise.resolve({ default: Boom, buildVersion: 'v-42' })}
      />,
    );
    await screen.findByRole('alert');
    const render = report.mock.calls.map(([e]) => e).find((e) => e.kind === 'render');
    expect(render).toMatchObject({ remote: 'products', kind: 'render', build: 'v-42' });
    expect(String(render.message)).toContain('kaboom');
  });

  it('Q-remoteframe-report: without a report prop nothing crashes and Retry still works', async () => {
    await mount(
      <RemoteFrame name="products" port={3001} load={() => Promise.reject(new Error('down'))} />,
    );
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/products is unavailable/)).toBeTruthy();
    await act(
      async () => void fireEvent.click(within(alert).getByRole('button', { name: 'Retry' })),
    );
    await screen.findByRole('alert');
  });
});

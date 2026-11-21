/** @vitest-environment jsdom */
// Q-mount-adapter: mountAdapter(name, mod) turns a mount-kind module into a RemoteFrame page module.
import { report } from '@mfe/telemetry';
import { RemoteFrame, type FrameError } from '@mfe/ui';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MountContext, MountModule } from '../../../federation.contract.ts';
vi.mock('@mfe/telemetry', () => ({ report: vi.fn() }));

import { mountAdapter } from '../src/MountAdapter.tsx';

const fake = (build = 'b1') => {
  const unmount = vi.fn();
  const mount = vi.fn((el: HTMLElement, ctx: MountContext) => {
    void ctx;
    el.textContent = `mounted ${build}`;
    return unmount;
  });
  const mod: MountModule = { mount, buildVersion: build };
  return { mod, mount, unmount };
};
const frame = (
  name: string,
  mod: MountModule,
  extra: { report?: (e: FrameError) => void } = {},
) => (
  <RemoteFrame
    key={name}
    name={name}
    port={3003}
    load={() => Promise.resolve(mountAdapter(name, mod))}
    {...extra}
  />
);
const show = (ui: React.ReactElement) => act(async () => void render(ui));

beforeEach(() => {
  document.documentElement.lang = 'en';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('mountAdapter', () => {
  it('Q-mount-adapter: the module keeps its buildVersion and mount gets a host element and ctx { locale, onError }', async () => {
    const f = fake();
    expect(mountAdapter('orders', f.mod).buildVersion).toBe('b1');
    await show(frame('orders', f.mod));
    expect(f.mount).toHaveBeenCalledTimes(1);
    const [el, ctx] = f.mount.mock.calls[0]!;
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.isConnected).toBe(true);
    expect(ctx.locale).toBe('en');
    expect(typeof ctx.onError).toBe('function');
    // inside the frame: label, port and build stamp are the frame's
    expect(screen.getByRole('region', { name: /orders/i })).toBeTruthy();
    expect(screen.getByText('build b1')).toBeTruthy();
    expect(screen.getByText(':3003')).toBeTruthy();
  });

  it('Q-mount-adapter: the German locale is passed on', async () => {
    document.documentElement.lang = 'de';
    const f = fake();
    await show(frame('orders', f.mod));
    expect(f.mount.mock.calls[0]![1].locale).toBe('de');
  });

  it('Q-mount-adapter: unmount runs once when the component unmounts', async () => {
    const f = fake();
    await show(frame('orders', f.mod));
    expect(f.unmount).not.toHaveBeenCalled();
    act(() => cleanup());
    expect(f.unmount).toHaveBeenCalledTimes(1);
  });

  it('Q-mount-adapter: a different remote unmounts the old one and mounts the new one', async () => {
    const a = fake('a');
    const b = fake('b');
    let rerender!: ReturnType<typeof render>['rerender'];
    await act(async () => void ({ rerender } = render(frame('orders', a.mod))));
    expect(a.mount).toHaveBeenCalledTimes(1);
    await act(async () => {
      rerender(frame('orders2', b.mod));
    });
    expect(a.unmount).toHaveBeenCalledTimes(1);
    expect(b.mount).toHaveBeenCalledTimes(1);
    expect(b.unmount).not.toHaveBeenCalled();
  });

  it('Q-mount-adapter: a language switch does not remount', async () => {
    const f = fake();
    await show(frame('orders', f.mod));
    const { emit } = await import('@mfe/events');
    await act(async () => {
      document.documentElement.lang = 'de';
      emit('locale:changed', { locale: 'de' });
    });
    expect(f.mount).toHaveBeenCalledTimes(1);
    expect(f.unmount).not.toHaveBeenCalled();
  });

  it('Q-mount-adapter: a synchronous throw from mount shows the frame error and reports the remote', async () => {
    const frameReport = vi.fn<(e: FrameError) => void>();
    const mod: MountModule = {
      mount: () => {
        throw new Error('mount exploded');
      },
      buildVersion: 'b9',
    };
    await show(frame('orders', mod, { report: frameReport }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/orders is unavailable/);
    expect(frameReport).toHaveBeenCalled();
    expect(frameReport.mock.calls[0]![0]).toMatchObject({ remote: 'orders', build: 'b9' });
    expect(frameReport.mock.calls[0]![0].message).toContain('mount exploded');
  });

  it('Q-mount-adapter: a failed load shows the frame error and reports the remote', async () => {
    const frameReport = vi.fn<(e: FrameError) => void>();
    await show(
      <RemoteFrame
        name="orders"
        port={3003}
        report={frameReport}
        load={() => Promise.reject(new Error('remote down'))}
      />,
    );
    await screen.findByRole('alert');
    expect(frameReport.mock.calls[0]![0]).toMatchObject({ remote: 'orders', kind: 'load' });
  });

  it('Q-mount-adapter: ctx.onError reports to telemetry with the remote name and build', async () => {
    const f = fake('b5');
    await show(frame('orders', f.mod));
    const ctx = f.mount.mock.calls[0]![1];
    ctx.onError(new Error('async trouble'));
    expect(report).toHaveBeenCalledTimes(1);
    expect(vi.mocked(report).mock.calls[0]![0]).toMatchObject({
      remote: 'orders',
      build: 'b5',
      message: 'async trouble',
    });
  });

  it('Q-mount-adapter: ctx.onError copes with a non-Error', async () => {
    const f = fake();
    await show(frame('orders', f.mod));
    f.mount.mock.calls[0]![1].onError('plain string');
    expect(vi.mocked(report).mock.calls[0]![0]).toMatchObject({
      remote: 'orders',
      message: 'plain string',
    });
  });
});

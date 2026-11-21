/** @vitest-environment jsdom */
// Q-mount-adapter. ASSUMPTIONS (phase 2 adapts): apps/shell/src/MountedRemote.tsx exports `MountedRemote` with
// props { name, origin?, load: () => Promise<MountModule>, report? }; it renders inside RemoteFrame and takes the
// locale from <html lang> (the repo's mechanism, RFC 0012).
import type { FrameError } from '@mfe/ui';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MountContext, MountModule } from '../../../federation.contract.ts';
vi.mock('@module-federation/enhanced/runtime', () => ({
  getInstance: () => null,
  init: vi.fn(),
  registerRemotes: vi.fn(),
  loadRemote: vi.fn(),
}));

import { MountedRemote } from '../src/MountedRemote.tsx';

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
const show = (ui: React.ReactElement) => act(async () => void render(ui));

beforeEach(() => {
  document.documentElement.lang = 'en';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MountedRemote', () => {
  it('Q-mount-adapter: mount gets a host element and ctx { locale, onError }', async () => {
    const f = fake();
    await show(<MountedRemote name="orders" port={3003} load={() => Promise.resolve(f.mod)} />);
    expect(f.mount).toHaveBeenCalledTimes(1);
    const [el, ctx] = f.mount.mock.calls[0]!;
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.isConnected).toBe(true);
    expect(ctx.locale).toBe('en');
    expect(typeof ctx.onError).toBe('function');
    // inside the frame: label and build stamp are the frame's
    expect(screen.getByRole('region', { name: /orders/i })).toBeTruthy();
    expect(screen.getByText('build b1')).toBeTruthy();
  });

  it('Q-mount-adapter: the German locale is passed on', async () => {
    document.documentElement.lang = 'de';
    const f = fake();
    await show(<MountedRemote name="orders" port={3003} load={() => Promise.resolve(f.mod)} />);
    expect(f.mount.mock.calls[0]![1].locale).toBe('de');
  });

  it('Q-mount-adapter: unmount runs once when the component unmounts', async () => {
    const f = fake();
    await show(<MountedRemote name="orders" port={3003} load={() => Promise.resolve(f.mod)} />);
    expect(f.unmount).not.toHaveBeenCalled();
    act(() => cleanup());
    expect(f.unmount).toHaveBeenCalledTimes(1);
  });

  it('Q-mount-adapter: a different remote unmounts the old one and mounts the new one', async () => {
    const a = fake('a');
    const b = fake('b');
    const { rerender } = render(
      <MountedRemote name="orders" port={3003} load={() => Promise.resolve(a.mod)} />,
    );
    await act(async () => {});
    expect(a.mount).toHaveBeenCalledTimes(1);
    await act(async () => {
      rerender(<MountedRemote name="orders2" port={3003} load={() => Promise.resolve(b.mod)} />);
    });
    expect(a.unmount).toHaveBeenCalledTimes(1);
    expect(b.mount).toHaveBeenCalledTimes(1);
    expect(b.unmount).not.toHaveBeenCalled();
  });

  it('Q-mount-adapter: a synchronous throw from mount shows the frame error and reports the remote', async () => {
    const report = vi.fn<(e: FrameError) => void>();
    const mod: MountModule = {
      mount: () => {
        throw new Error('mount exploded');
      },
      buildVersion: 'b9',
    };
    await show(
      <MountedRemote name="orders" port={3003} report={report} load={() => Promise.resolve(mod)} />,
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/orders is unavailable/);
    expect(report).toHaveBeenCalled();
    expect(report.mock.calls[0]![0]).toMatchObject({ remote: 'orders' });
    expect(report.mock.calls[0]![0].message).toContain('mount exploded');
  });

  it('Q-mount-adapter: a failed load shows the frame error and reports the remote', async () => {
    const report = vi.fn<(e: FrameError) => void>();
    await show(
      <MountedRemote
        name="orders"
        port={3003}
        report={report}
        load={() => Promise.reject(new Error('remote down'))}
      />,
    );
    await screen.findByRole('alert');
    expect(report.mock.calls[0]![0]).toMatchObject({ remote: 'orders', kind: 'load' });
  });

  it('Q-mount-adapter: ctx.onError reports with the remote name', async () => {
    const report = vi.fn<(e: FrameError) => void>();
    const f = fake();
    await show(
      <MountedRemote
        name="orders"
        port={3003}
        report={report}
        load={() => Promise.resolve(f.mod)}
      />,
    );
    const ctx = f.mount.mock.calls[0]![1];
    act(() => ctx.onError(new Error('async trouble')));
    expect(report).toHaveBeenCalled();
    const e = report.mock.calls.map(([x]) => x).find((x) => x.message.includes('async trouble'));
    expect(e).toMatchObject({ remote: 'orders' });
  });
});

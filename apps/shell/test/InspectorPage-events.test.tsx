/** @vitest-environment jsdom */
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rt = vi.hoisted(() => ({ instance: null as unknown }));
vi.mock('@module-federation/enhanced/runtime', () => ({
  getInstance: () => rt.instance,
  registerRemotes: vi.fn(),
  loadRemote: vi.fn(),
}));

beforeEach(() => {
  rt.instance = null;
  vi.resetModules();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('no', { status: 500 }))),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('InspectorPage events', () => {
  it('Q-inspector-events: heading, headers, empty row, then a live row', async () => {
    const { startEventLog } = await import('../src/eventLog.ts');
    const { emit } = await import('@mfe/events');
    const { default: InspectorPage } = await import('../src/InspectorPage.tsx');
    startEventLog();
    await act(async () => void render(<InspectorPage />));

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    const i = headings.indexOf('Events');
    expect(i).toBeGreaterThan(headings.indexOf('Shared dependencies'));
    expect(headings.indexOf('How to break this')).toBe(i + 1);

    const table = screen
      .getAllByRole('table')
      .find((t) => within(t).queryByRole('columnheader', { name: 'Payload' })) as HTMLElement;
    for (const h of ['Time', 'Event', 'Payload']) {
      expect(within(table).getByRole('columnheader', { name: h })).toBeTruthy();
    }
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).getByText('No events yet')).toBeTruthy();

    act(() => emit('products:changed', { id: 42, kind: 'updated' }));

    expect(within(table).queryByText('No events yet')).toBeNull();
    const row = within(table).getByText('products:changed').closest('tr') as HTMLElement;
    const cells = within(row)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    expect(cells[0]).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(cells[1]).toBe('products:changed');
    expect(cells[2]).toBe(JSON.stringify({ id: 42, kind: 'updated' }));

    expect(screen.getByRole('table', { name: 'Events' })).toBe(table);
    const time = within(row)
      .getByText(cells[0] as string)
      .closest('time');
    expect(time?.getAttribute('datetime')).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
    );
  });
});

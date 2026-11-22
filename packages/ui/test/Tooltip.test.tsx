/** @vitest-environment jsdom */
// Q-tooltip: Tooltip popup is role=tooltip, hidden while closed, wired by aria-describedby when open; Popover API stubbed.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tooltip } from '../src/index.ts';

beforeAll(() => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.showPopover ??= vi.fn();
  proto.hidePopover ??= vi.fn();
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const setup = () => {
  render(
    <Tooltip content="Full text">
      <button type="button">Trigger</button>
    </Tooltip>,
  );
  return screen.getByRole('button', { name: 'Trigger' });
};
// The popup is always in the DOM (hidden attribute when closed) and jsdom treats popover=manual as display:none,
// so look at the role with hidden:true and honour the `hidden` attribute ourselves.
const tip = () => {
  const open = screen.queryAllByRole('tooltip', { hidden: true }).filter((e) => !e.hidden);
  expect(open.length).toBeLessThanOrEqual(1);
  return open[0] ?? null;
};
const shown = () => tip() as HTMLElement;
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const hover = (el: Element) =>
  act(() => {
    fireEvent.pointerEnter(el);
    fireEvent.mouseEnter(el);
  });
const unhover = (el: Element) =>
  act(() => {
    fireEvent.pointerLeave(el);
    fireEvent.mouseLeave(el);
  });

describe('Tooltip', () => {
  it('Q-tooltip: closed by default', () => {
    setup();
    expect(tip()).toBeNull();
  });

  it('Q-tooltip: focus shows it immediately and aria-describedby points to it', () => {
    const trigger = setup();
    act(() => trigger.focus());
    const t = shown();
    expect(t.textContent).toBe('Full text');
    expect(t.id).not.toBe('');
    expect(trigger.closest('[aria-describedby]')?.getAttribute('aria-describedby')).toBe(t.id);
  });

  it('Q-tooltip: hover shows it after 300 ms, not before', async () => {
    const trigger = setup();
    await hover(trigger);
    await advance(299);
    expect(tip()).toBeNull();
    await advance(1);
    expect(shown().textContent).toBe('Full text');
    expect(trigger.closest('[aria-describedby]')?.getAttribute('aria-describedby')).toBe(
      shown().id,
    );
  });

  it('Q-tooltip: leaving before 300 ms never shows it', async () => {
    const trigger = setup();
    await hover(trigger);
    await advance(200);
    await unhover(trigger);
    await advance(1000);
    expect(tip()).toBeNull();
  });

  it('Q-tooltip: Escape hides it and focus stays on the trigger', () => {
    const trigger = setup();
    act(() => trigger.focus());
    expect(tip()).not.toBeNull();
    act(() => void fireEvent.keyDown(trigger, { key: 'Escape' }));
    expect(tip()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('Q-tooltip: blur hides it', () => {
    const trigger = setup();
    act(() => trigger.focus());
    expect(tip()).not.toBeNull();
    act(() => trigger.blur());
    expect(tip()).toBeNull();
  });

  it('Q-tooltip: pointer leave hides it', async () => {
    const trigger = setup();
    await hover(trigger);
    await advance(300);
    expect(tip()).not.toBeNull();
    await unhover(trigger);
    await advance(1000);
    expect(tip()).toBeNull();
  });

  it('Q-tooltip: moving the pointer onto the tooltip keeps it open (hoverable), leaving it closes', async () => {
    const trigger = setup();
    await hover(trigger);
    await advance(300);
    const t = shown();
    await unhover(trigger);
    await hover(t);
    await advance(1000);
    expect(tip()).not.toBeNull();
    await unhover(t);
    await advance(1000);
    expect(tip()).toBeNull();
  });
});

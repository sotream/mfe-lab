// Q-select-core against the real API:
//   keyAction(state {open, activeIndex, buffer?, at?}, key, opts {options, selectedIndex, alt?})
//     -> {open, activeIndex, buffer, at, select?: index, close?, preventDefault}
//   typeahead(buffer, options, from) -> index | -1;  placePopup(triggerRect, popup, viewport)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keyAction, placePopup, typeahead } from '@mfe/ui/select-core';

const options = [
  { value: 'a', label: 'Apple' },
  { value: 'b', label: 'Banana', disabled: true },
  { value: 'c', label: 'Cherry' },
  { value: 'd', label: 'Date' },
  { value: 'e', label: 'Elder', disabled: true },
];
afterEach(() => vi.useRealTimers());
const closed = (activeIndex = 0) => ({ open: false, activeIndex });
const open = (activeIndex = 0) => ({ open: true, activeIndex });
const act = (
  state: { open: boolean; activeIndex: number; buffer?: string; at?: number },
  key: string,
  alt = false,
  selectedIndex = state.activeIndex,
) => keyAction(state, key, { options, selectedIndex, alt });

describe('keyAction', () => {
  it.each(['ArrowDown', 'ArrowUp', 'Enter', ' '])(
    'Q-select-core: %s opens a closed select on the selected option',
    (key) => {
      const r = act(closed(2), key);
      expect(r.open).toBe(true);
      expect(r.activeIndex).toBe(2);
      expect(r.select).toBeUndefined();
    },
  );
  it('Q-select-core: Home and End open a closed select on the first and last enabled option', () => {
    expect(act(closed(2), 'Home')).toMatchObject({ open: true, activeIndex: 0 });
    expect(act(closed(0), 'End')).toMatchObject({ open: true, activeIndex: 3 });
  });
  it('Q-select-core: Alt+ArrowDown opens a closed select', () => {
    expect(act(closed(2), 'ArrowDown', true).open).toBe(true);
  });
  it('Q-select-core: Alt+Arrow on an open select selects the active option and closes', () => {
    const r = act(open(2), 'ArrowUp', true);
    expect(r.open).toBe(false);
    expect(r.select).toBe(2);
  });
  it('Q-select-core: arrows move and skip disabled options', () => {
    expect(act(open(0), 'ArrowDown').activeIndex).toBe(2);
    expect(act(open(2), 'ArrowUp').activeIndex).toBe(0);
    expect(act(open(2), 'ArrowDown').activeIndex).toBe(3);
  });
  it('Q-select-core: arrows clamp at the ends (no wrap)', () => {
    expect(act(open(0), 'ArrowUp').activeIndex).toBe(0);
    expect(act(open(3), 'ArrowDown').activeIndex).toBe(3); // 4 is disabled
  });
  it('Q-select-core: Home and End go to first and last enabled option', () => {
    expect(act(open(3), 'Home').activeIndex).toBe(0);
    expect(act(open(0), 'End').activeIndex).toBe(3);
  });
  it('Q-select-core: PageDown and PageUp jump (10), clamped to enabled options', () => {
    expect(act(open(0), 'PageDown').activeIndex).toBe(3);
    expect(act(open(3), 'PageUp').activeIndex).toBe(0);
  });
  it.each(['Enter', ' '])(
    'Q-select-core: %s on an open select selects the active option and closes',
    (key) => {
      const r = act(open(2), key);
      expect(r.select).toBe(2);
      expect(r.open).toBe(false);
    },
  );
  it('Q-select-core: Escape closes without selecting', () => {
    const r = act(open(2), 'Escape');
    expect(r.open).toBe(false);
    expect(r.close).toBe(true);
    expect(r.select).toBeUndefined();
  });
  it('Q-select-core: Tab selects the active option, closes, and does not preventDefault', () => {
    const r = act(open(2), 'Tab');
    expect(r.select).toBe(2);
    expect(r.open).toBe(false);
    expect(r.preventDefault).toBe(false);
  });
  it('Q-select-core: Tab on a closed select does nothing and is not prevented', () => {
    const r = act(closed(2), 'Tab');
    expect(r.open).toBe(false);
    expect(r.select).toBeUndefined();
    expect(r.preventDefault).toBe(false);
  });
  it('Q-select-core: a printable key on a closed select picks a value without opening', () => {
    const r = act(closed(0), 'c');
    expect(r.open).toBe(false);
    expect(r.select).toBe(2);
  });
  it('Q-select-core: a printable key never picks a disabled option', () => {
    expect(act(closed(0), 'b').select).toBeUndefined();
  });
  it('Q-select-core: a printable key on an open select moves the active option only', () => {
    const r = act(open(0), 'd');
    expect(r.open).toBe(true);
    expect(r.activeIndex).toBe(3);
    expect(r.select).toBeUndefined();
  });
  it('Q-select-core: the type-ahead buffer grows within 500 ms and resets after (fake timers)', () => {
    vi.useFakeTimers();
    const opts = [
      { value: '1', label: 'Cat' },
      { value: '2', label: 'Cow' },
      { value: '3', label: 'Dog' },
    ];
    const press = (
      st: { open: boolean; activeIndex: number; buffer?: string; at?: number },
      k: string,
    ) => keyAction(st, k, { options: opts, selectedIndex: 0 });
    let r = press(open(0), 'c');
    r = press(r, 'o');
    expect(r.activeIndex).toBe(1); // "co" -> Cow
    vi.advanceTimersByTime(600);
    r = press(r, 'd'); // buffer reset: "d", not "cod"
    expect(r.buffer).toBe('d');
    expect(r.activeIndex).toBe(2);
  });
});

describe('typeahead', () => {
  it('Q-select-core: matches by label prefix, case-insensitive', () => {
    expect(typeahead('ch', options, 0)).toBe(2);
    expect(typeahead('D', options, 0)).toBe(3);
  });
  it('Q-select-core: no match gives -1; empty buffer gives -1', () => {
    expect(typeahead('zz', options, 0)).toBe(-1);
    expect(typeahead('', options, 0)).toBe(-1);
  });
  it('Q-select-core: skips disabled options', () => {
    expect(typeahead('b', options, 0)).toBe(-1);
  });
  it('Q-select-core: starts at from (inclusive) and wraps', () => {
    expect(typeahead('c', options, 2)).toBe(2);
    expect(typeahead('a', options, 3)).toBe(0);
  });
  it('Q-select-core: a repeated single char cycles from from+1', () => {
    const opts = [
      { value: '1', label: 'Alpha' },
      { value: '2', label: 'Beta' },
      { value: '3', label: 'Apricot' },
      { value: '4', label: 'Avocado' },
    ];
    expect(typeahead('aa', opts, 0)).toBe(2);
    expect(typeahead('aa', opts, 2)).toBe(3);
    expect(typeahead('aa', opts, 3)).toBe(0);
  });
});

const vp = { width: 1000, height: 800 };
const rect = (top: number, left = 100, width = 200, height = 36) => ({
  top,
  left,
  width,
  height,
  bottom: top + height,
  right: left + width,
});
const pop = { width: 150, height: 200 };

describe('placePopup', () => {
  it('Q-select-core: opens below the trigger by default, trigger width at least', () => {
    const p = placePopup(rect(100), pop, vp);
    expect(p.side).toBe('bottom');
    expect(p.top).toBeGreaterThanOrEqual(136);
    expect(p.width).toBeGreaterThanOrEqual(200);
    expect(p.left).toBe(100);
  });
  it('Q-select-core: flips above when there is no room below but more above', () => {
    const p = placePopup(rect(700), pop, vp);
    expect(p.side).toBe('top');
    expect(p.top + Math.min(pop.height, p.maxHeight)).toBeLessThanOrEqual(700);
  });
  it('Q-select-core: stays below when there is more room below than above', () => {
    expect(placePopup(rect(20), { width: 150, height: 900 }, vp).side).toBe('bottom');
  });
  it('Q-select-core: never leaves the viewport (8 px margin), maxHeight shrinks to fit', () => {
    const p = placePopup(rect(20), { width: 150, height: 900 }, vp);
    expect(p.top).toBeGreaterThanOrEqual(8);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(vp.height - 8);
  });
  it('Q-select-core: clamps horizontally', () => {
    const p = placePopup(rect(100, 900, 200), { width: 400, height: 100 }, vp);
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.left + p.width).toBeLessThanOrEqual(vp.width - 8);
    const q = placePopup(rect(100, -50, 200), pop, vp);
    expect(q.left).toBeGreaterThanOrEqual(8);
  });
  it('Q-select-core: a long option makes the popup wider than the trigger', () => {
    expect(
      placePopup(rect(100, 100, 120), { width: 300, height: 100 }, vp).width,
    ).toBeGreaterThanOrEqual(300);
  });
});

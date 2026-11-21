// Q-select-core. ASSUMPTIONS (phase 2 adapts to the real names/shapes):
//   keyAction(state: {open, activeIndex}, key: string, opts: {options: {disabled?}[], altKey?: boolean})
//     -> {open, activeIndex, select?: boolean, close?: boolean}   (select = pick the returned activeIndex)
//   typeahead(buffer: string, options: {label, disabled?}[], from: number) -> index or -1
//   placePopup(triggerRect, popupSize {width,height}, viewport {width,height}) -> {top,left,width,maxHeight,side}
import { describe, expect, it } from 'vitest';
import { keyAction, placePopup, typeahead } from '@mfe/ui/select-core';

const options = [
  { value: 'a', label: 'Apple' },
  { value: 'b', label: 'Banana', disabled: true },
  { value: 'c', label: 'Cherry' },
  { value: 'd', label: 'Date' },
  { value: 'e', label: 'Elder', disabled: true },
];
const closed = (activeIndex = 0) => ({ open: false, activeIndex });
const open = (activeIndex = 0) => ({ open: true, activeIndex });
const act = (state: { open: boolean; activeIndex: number }, key: string, altKey = false) =>
  keyAction(state, key, { options, altKey });

describe('keyAction', () => {
  it.each(['ArrowDown', 'Enter', ' '])(
    'Q-select-core: %s opens a closed select on the active index',
    (key) => {
      const r = act(closed(2), key);
      expect(r.open).toBe(true);
      expect(r.activeIndex).toBe(2);
      expect(r.select).toBeFalsy();
    },
  );
  it('Q-select-core: Alt+ArrowDown opens, Alt+ArrowUp on open closes without selecting', () => {
    expect(act(closed(2), 'ArrowDown', true).open).toBe(true);
    const r = act(open(2), 'ArrowUp', true);
    expect(r.open).toBe(false);
  });
  it('Q-select-core: arrows move and skip disabled options', () => {
    expect(act(open(0), 'ArrowDown').activeIndex).toBe(2);
    expect(act(open(2), 'ArrowUp').activeIndex).toBe(0);
    expect(act(open(2), 'ArrowDown').activeIndex).toBe(3);
  });
  it('Q-select-core: arrows stop at the ends (no wrap)', () => {
    expect(act(open(0), 'ArrowUp').activeIndex).toBe(0);
    expect(act(open(3), 'ArrowDown').activeIndex).toBe(3); // 4 is disabled
  });
  it('Q-select-core: Home and End go to first and last enabled option', () => {
    expect(act(open(3), 'Home').activeIndex).toBe(0);
    expect(act(open(0), 'End').activeIndex).toBe(3);
  });
  it('Q-select-core: PageDown and PageUp jump, clamped to enabled options', () => {
    expect(act(open(0), 'PageDown').activeIndex).toBe(3);
    expect(act(open(3), 'PageUp').activeIndex).toBe(0);
  });
  it.each(['Enter', ' '])(
    'Q-select-core: %s on an open select selects the active option and closes',
    (key) => {
      const r = act(open(2), key);
      expect(r.select).toBe(true);
      expect(r.activeIndex).toBe(2);
      expect(r.open).toBe(false);
    },
  );
  it('Q-select-core: Escape closes without selecting', () => {
    const r = act(open(2), 'Escape');
    expect(r.open).toBe(false);
    expect(r.select).toBeFalsy();
  });
  it('Q-select-core: Tab selects the active option and closes; focus is not trapped', () => {
    const r = act(open(2), 'Tab');
    expect(r.select).toBe(true);
    expect(r.open).toBe(false);
  });
  it('Q-select-core: Tab on a closed select does nothing', () => {
    const r = act(closed(2), 'Tab');
    expect(r.open).toBe(false);
    expect(r.select).toBeFalsy();
  });
  it('Q-select-core: Escape on a closed select is a no-op', () => {
    expect(act(closed(1), 'Escape')).toMatchObject({ open: false, activeIndex: 1 });
  });
  it('Q-select-core: a printable character on a closed select opens it or moves; never selects a disabled option', () => {
    const r = act(closed(0), 'c');
    expect(r.activeIndex).toBe(2);
    const d = act(closed(0), 'b'); // Banana is disabled
    expect(d.activeIndex).not.toBe(1);
  });
});

describe('typeahead', () => {
  it('Q-select-core: matches by label prefix, case-insensitive', () => {
    expect(typeahead('ch', options, 0)).toBe(2);
    expect(typeahead('D', options, 0)).toBe(3);
  });
  it('Q-select-core: no match gives -1', () => {
    expect(typeahead('zz', options, 0)).toBe(-1);
  });
  it('Q-select-core: skips disabled options', () => {
    expect(typeahead('b', options, 0)).toBe(-1);
  });
  it('Q-select-core: the same letter repeated cycles through matches from the active index', () => {
    const opts = [
      { value: '1', label: 'Alpha' },
      { value: '2', label: 'Beta' },
      { value: '3', label: 'Apricot' },
      { value: '4', label: 'Avocado' },
    ];
    expect(typeahead('a', opts, 0)).toBe(2);
    expect(typeahead('a', opts, 2)).toBe(3);
    expect(typeahead('a', opts, 3)).toBe(0); // wraps
  });
});

describe('typeahead reset', () => {
  // The 500 ms reset lives wherever the buffer lives; the core is pure, so the contract is: the buffer
  // handed in is what is matched. A fresh one-letter buffer after a pause matches from scratch.
  it('Q-select-core: a fresh buffer after the pause ignores the previous letters', () => {
    expect(typeahead('c', options, 0)).toBe(2);
    expect(typeahead('ca', options, 0)).toBe(-1);
    expect(typeahead('a', options, 0)).toBe(0);
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

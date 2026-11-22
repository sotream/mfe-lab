/** @vitest-environment jsdom */
// Q-select-react: Select roles, selection, keyboard and disabled behavior; Popover API stubbed for jsdom.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Select } from '../src/index.ts';

const OPTIONS = [
  { value: 'a', label: 'Apple' },
  { value: 'b', label: 'Banana', disabled: true },
  { value: 'c', label: 'Cherry' },
  { value: 'd', label: 'Date' },
];

beforeAll(() => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.showPopover ??= vi.fn();
  proto.hidePopover ??= vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const onChange = vi.fn();
function Harness({
  initial = 'a',
  name,
  disabled,
}: {
  initial?: string;
  name?: string;
  disabled?: boolean;
}) {
  const [v, setV] = useState(initial);
  return (
    <form>
      <label id="fruit-label" htmlFor="fruit">
        Fruit
      </label>
      <Select
        id="fruit"
        labelId="fruit-label"
        options={OPTIONS}
        value={v}
        name={name}
        disabled={disabled}
        onChange={(x: string) => {
          onChange(x);
          setV(x);
        }}
      />
      <button type="button">after</button>
    </form>
  );
}
const trigger = () => screen.getByRole('combobox');
const optionEls = () => screen.getAllByRole('option', { hidden: true });
const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => void fireEvent.keyDown(trigger(), { key, ...init }));
const openIt = () => press('ArrowDown');

describe('Select (React)', () => {
  it('Q-select-react: closed ARIA', () => {
    render(<Harness />);
    const t = trigger();
    expect(t.getAttribute('aria-haspopup')).toBe('listbox');
    expect(t.getAttribute('aria-expanded')).toBe('false');
    expect(t.getAttribute('tabindex')).toBe('0');
    expect(t.getAttribute('aria-labelledby')).toBe('fruit-label');
    expect(t.textContent).toContain('Apple');
    expect(t.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('Q-select-react: aria-label is used when there is no labelId', () => {
    render(<Select options={OPTIONS} value="a" onChange={() => {}} aria-label="Pick" />);
    expect(screen.getByRole('combobox', { name: 'Pick' })).toBeTruthy();
  });

  it('Q-select-react: open ARIA, listbox and options with ids, selected and disabled flags', () => {
    render(<Harness initial="c" />);
    openIt();
    const t = trigger();
    expect(t.getAttribute('aria-expanded')).toBe('true');
    const lb = screen.getByRole('listbox', { hidden: true });
    expect(t.getAttribute('aria-controls')).toBe(lb.id);
    expect(lb.getAttribute('popover')).toBe('manual');
    const opts = optionEls();
    expect(opts.map((o) => o.textContent?.trim())).toEqual(['Apple', 'Banana', 'Cherry', 'Date']);
    expect(opts.every((o) => o.id)).toBe(true);
    expect(new Set(opts.map((o) => o.id)).size).toBe(4);
    expect(opts.map((o) => o.getAttribute('aria-selected'))).toEqual([
      'false',
      'false',
      'true',
      'false',
    ]);
    expect(opts[1]!.getAttribute('aria-disabled')).toBe('true');
    // opening puts the active option on the selected one
    expect(t.getAttribute('aria-activedescendant')).toBe(opts[2]!.id);
  });

  it('Q-select-react: aria-activedescendant follows the arrows and skips disabled', () => {
    render(<Harness initial="a" />);
    openIt();
    const ids = optionEls().map((o) => o.id);
    expect(trigger().getAttribute('aria-activedescendant')).toBe(ids[0]);
    press('ArrowDown');
    expect(trigger().getAttribute('aria-activedescendant')).toBe(ids[2]); // Banana skipped
    press('ArrowDown');
    expect(trigger().getAttribute('aria-activedescendant')).toBe(ids[3]);
    press('ArrowUp');
    expect(trigger().getAttribute('aria-activedescendant')).toBe(ids[2]);
    press('Home');
    expect(trigger().getAttribute('aria-activedescendant')).toBe(ids[0]);
    press('End');
    expect(trigger().getAttribute('aria-activedescendant')).toBe(ids[3]);
  });

  it.each(['Enter', ' ', 'ArrowDown'])('Q-select-react: %s opens', (key) => {
    render(<Harness />);
    press(key);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('Q-select-react: Alt+ArrowDown opens', () => {
    render(<Harness />);
    press('ArrowDown', { altKey: true });
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('Q-select-react: a click opens, Enter selects, closes and calls onChange', () => {
    onChange.mockClear();
    render(<Harness />);
    fireEvent.click(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    press('ArrowDown');
    press('Enter');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('c');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().textContent).toContain('Cherry');
  });

  it('Q-select-react: Space selects too', () => {
    onChange.mockClear();
    render(<Harness />);
    openIt();
    press('End');
    press(' ');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('d');
  });

  it('Q-select-react: clicking an option selects it and closes', () => {
    onChange.mockClear();
    render(<Harness />);
    fireEvent.click(trigger());
    fireEvent.click(optionEls()[3]!);
    expect(onChange).toHaveBeenCalledExactlyOnceWith('d');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('Q-select-react: a disabled option cannot be selected by click or keyboard', () => {
    onChange.mockClear();
    render(<Harness />);
    fireEvent.click(trigger());
    fireEvent.click(optionEls()[1]!);
    expect(onChange).not.toHaveBeenCalled();
    press('ArrowDown');
    press('Enter');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('c');
  });

  it('Q-select-react: Escape closes, keeps the value and the focus on the trigger', () => {
    onChange.mockClear();
    render(<Harness />);
    trigger().focus();
    openIt();
    press('ArrowDown');
    press('Escape');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger().textContent).toContain('Apple');
    expect(document.activeElement).toBe(trigger());
  });

  it('Q-select-react: Tab selects the active option and does not trap focus', () => {
    onChange.mockClear();
    render(<Harness />);
    openIt();
    press('ArrowDown');
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => void trigger().dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(false);
    expect(onChange).toHaveBeenCalledExactlyOnceWith('c');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('Q-select-react: a click outside closes without a change', () => {
    onChange.mockClear();
    render(<Harness />);
    openIt();
    act(() => void fireEvent.pointerDown(document.body));
    act(() => void fireEvent.mouseDown(document.body));
    act(() => void fireEvent.click(document.body));
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Q-select-react: clicking the label focuses the trigger', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Fruit'));
    expect(document.activeElement).toBe(trigger());
  });

  it('Q-select-react: type-ahead moves to the matching option and resets after 500 ms', () => {
    vi.useFakeTimers();
    render(<Harness />);
    openIt();
    const ids = optionEls().map((o) => o.id);
    press('d');
    expect(trigger().getAttribute('aria-activedescendant')).toBe(ids[3]);
    press('c');
    // "dc" matches nothing: the active option stays
    expect(trigger().getAttribute('aria-activedescendant')).toBe(ids[3]);
    act(() => void vi.advanceTimersByTime(600));
    press('c');
    expect(trigger().getAttribute('aria-activedescendant')).toBe(ids[2]);
  });

  it('Q-select-react: the hidden input carries the value when name is set', () => {
    const { container } = render(<Harness name="fruit" initial="c" />);
    const input = container.querySelector('input[name="fruit"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('c');
    expect(new FormData(container.querySelector('form')!).get('fruit')).toBe('c');
  });

  it('Q-select-react: no hidden input without a name', () => {
    const { container } = render(<Harness />);
    expect(container.querySelector('input')).toBeNull();
  });

  it('Q-select-react: a disabled select does not open', () => {
    render(<Harness disabled />);
    fireEvent.click(trigger());
    press('ArrowDown');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().getAttribute('aria-disabled')).toBe('true');
  });
});

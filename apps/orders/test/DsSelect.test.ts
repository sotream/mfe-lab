/** @vitest-environment jsdom */
// Q-select-vue. ASSUMPTIONS: apps/orders/src/DsSelect.vue (default export) takes props options, modelValue, labelId
// and emits update:modelValue. Same markup as the React Select: role=combobox trigger, role=listbox popup,
// role=option items. Mounted inside an open shadow root. jsdom has no Popover API: stubbed.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import DsSelect from '../src/DsSelect.vue';

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

let host: HTMLElement;
let app: ReturnType<typeof createApp> | undefined;
const model = ref('a');
const updates: string[] = [];
const root = () => host.shadowRoot!;
const trigger = () => root().querySelector('[role="combobox"]') as HTMLElement;
const opts = () => [...root().querySelectorAll('[role="option"]')] as HTMLElement[];
const key = async (k: string, init: KeyboardEventInit = {}) => {
  trigger().dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
  );
  await nextTick();
};

function start(initial = 'a') {
  model.value = initial;
  updates.length = 0;
  host = document.createElement('div');
  document.body.append(host);
  const sr = host.attachShadow({ mode: 'open' });
  const mountPoint = document.createElement('div');
  sr.append(mountPoint);
  app = createApp({
    render: () =>
      h('div', [
        h('label', { id: 'st-label', for: 'st' }, 'Status'),
        h(DsSelect, {
          options: OPTIONS,
          modelValue: model.value,
          labelId: 'st-label',
          'onUpdate:modelValue': (v: string) => {
            updates.push(v);
            model.value = v;
          },
        }),
      ]),
  });
  app.mount(mountPoint);
}
afterEach(() => {
  app?.unmount();
  host?.remove();
});

describe('DsSelect (Vue, shadow root)', () => {
  it('Q-select-vue: closed ARIA', () => {
    start();
    const t = trigger();
    expect(t.getAttribute('aria-haspopup')).toBe('listbox');
    expect(t.getAttribute('aria-expanded')).toBe('false');
    expect(t.getAttribute('tabindex')).toBe('0');
    expect(t.getAttribute('aria-labelledby')).toBe('st-label');
    expect(t.textContent).toContain('Apple');
  });

  it('Q-select-vue: open ARIA, option ids, selected and disabled flags, active on the selected', async () => {
    start('c');
    await key('ArrowDown');
    const t = trigger();
    expect(t.getAttribute('aria-expanded')).toBe('true');
    const lb = root().querySelector('[role="listbox"]')!;
    expect(t.getAttribute('aria-controls')).toBe(lb.id);
    expect(lb.getAttribute('popover')).toBe('manual');
    expect(opts().map((o) => o.getAttribute('aria-selected'))).toEqual([
      'false',
      'false',
      'true',
      'false',
    ]);
    expect(opts()[1]!.getAttribute('aria-disabled')).toBe('true');
    expect(t.getAttribute('aria-activedescendant')).toBe(opts()[2]!.id);
  });

  it('Q-select-vue: activedescendant follows arrows, skips disabled, Home and End', async () => {
    start();
    await key('ArrowDown');
    const ids = opts().map((o) => o.id);
    await key('ArrowDown');
    expect(trigger().getAttribute('aria-activedescendant')).toBe(ids[2]);
    await key('ArrowDown');
    expect(trigger().getAttribute('aria-activedescendant')).toBe(ids[3]);
    await key('Home');
    expect(trigger().getAttribute('aria-activedescendant')).toBe(ids[0]);
    await key('End');
    expect(trigger().getAttribute('aria-activedescendant')).toBe(ids[3]);
  });

  it('Q-select-vue: Enter selects, emits update:modelValue and closes', async () => {
    start();
    await key('ArrowDown');
    await key('ArrowDown');
    await key('Enter');
    expect(updates).toEqual(['c']);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().textContent).toContain('Cherry');
  });

  it('Q-select-vue: a click opens, a click on an option selects; a disabled option does not', async () => {
    start();
    trigger().click();
    await nextTick();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    opts()[1]!.click();
    await nextTick();
    expect(updates).toEqual([]);
    opts()[3]!.click();
    await nextTick();
    expect(updates).toEqual(['d']);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('Q-select-vue: Escape closes without a change and returns focus to the trigger', async () => {
    start();
    trigger().focus();
    await key('ArrowDown');
    await key('ArrowDown');
    await key('Escape');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(updates).toEqual([]);
    expect(root().activeElement).toBe(trigger());
  });

  it('Q-select-vue: Tab selects the active option and is not prevented', async () => {
    start();
    await key('ArrowDown');
    await key('ArrowDown');
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    trigger().dispatchEvent(ev);
    await nextTick();
    expect(ev.defaultPrevented).toBe(false);
    expect(updates).toEqual(['c']);
  });

  it('Q-select-vue: a click outside the shadow root closes', async () => {
    start();
    await key('ArrowDown');
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.body.click();
    await nextTick();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(updates).toEqual([]);
  });

  it('Q-select-vue: clicking the label focuses the trigger', async () => {
    start();
    (root().querySelector('label') as HTMLElement).click();
    await nextTick();
    expect(root().activeElement).toBe(trigger());
  });

  it('Q-select-vue: type-ahead moves to the match and resets after 500 ms', async () => {
    vi.useFakeTimers();
    try {
      start();
      await key('ArrowDown');
      const ids = opts().map((o) => o.id);
      await key('d');
      expect(trigger().getAttribute('aria-activedescendant')).toBe(ids[3]);
      await key('c');
      expect(trigger().getAttribute('aria-activedescendant')).toBe(ids[3]);
      vi.advanceTimersByTime(600);
      await key('c');
      expect(trigger().getAttribute('aria-activedescendant')).toBe(ids[2]);
    } finally {
      vi.useRealTimers();
    }
  });
});

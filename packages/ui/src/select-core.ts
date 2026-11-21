// Framework-free core of the select-only combobox (WAI-ARIA APG). No React, no Vue: the React
// `Select` and the Vue `DsSelect` both sit on this, so keyboard, type-ahead and placement match.

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type KeyState = { open: boolean; activeIndex: number; buffer?: string; at?: number };
export type KeyOpts = { options: readonly SelectOption[]; selectedIndex: number; alt?: boolean };
export type KeyResult = {
  open: boolean;
  activeIndex: number;
  buffer: string;
  at: number;
  /** Index to commit as the value. */
  select?: number;
  /** Close and return focus to the trigger (Escape). */
  close?: boolean;
  preventDefault: boolean;
};

export const TYPEAHEAD_MS = 500;
const PAGE = 10;

const enabled = (options: readonly SelectOption[], i: number) => !options[i]?.disabled;

function firstEnabled(options: readonly SelectOption[], from = 0, step = 1): number {
  for (let i = from; i >= 0 && i < options.length; i += step) if (enabled(options, i)) return i;
  return -1;
}

/** Move `by` enabled options from `from`, clamped to the first and last enabled one. */
function move(options: readonly SelectOption[], from: number, by: number): number {
  const step = Math.sign(by);
  let at = from;
  for (let n = Math.abs(by); n > 0; n--) {
    const next = firstEnabled(options, at + step, step);
    if (next < 0) break;
    at = next;
  }
  return at;
}

/**
 * Prefix match over enabled options, starting at `from` and wrapping. A buffer of one repeated
 * character ("aa") cycles through the options starting with that character instead.
 * Returns -1 when nothing matches.
 */
export function typeahead(buffer: string, options: readonly SelectOption[], from: number): number {
  const text = buffer.toLowerCase();
  if (!text) return -1;
  const cycle = [...text].every((c) => c === text[0]);
  const needle = cycle ? text[0]! : text;
  const start = cycle ? from + 1 : from;
  for (let n = 0; n < options.length; n++) {
    const i = (((start + n) % options.length) + options.length) % options.length;
    if (enabled(options, i) && options[i]!.label.toLowerCase().startsWith(needle)) return i;
  }
  return -1;
}

type Ctx = KeyOpts & { state: KeyState; now: number };

const last = (options: readonly SelectOption[]) => firstEnabled(options, options.length - 1, -1);
const pick = (options: readonly SelectOption[], i: number) => (enabled(options, i) ? i : undefined);

function typed({ state, now, options }: Ctx, key: string, from: number) {
  const buffer = (now - (state.at ?? 0) > TYPEAHEAD_MS ? '' : (state.buffer ?? '')) + key;
  return { buffer, hit: typeahead(buffer, options, from) };
}

type Step = Partial<KeyResult>;

function closedKey(c: Ctx, key: string): Step {
  const { options, selectedIndex, state } = c;
  const start =
    selectedIndex >= 0 && enabled(options, selectedIndex) ? selectedIndex : firstEnabled(options);
  if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(key))
    return { open: true, activeIndex: start };
  if (key === 'Home') return { open: true, activeIndex: firstEnabled(options) };
  if (key === 'End') return { open: true, activeIndex: last(options) };
  if (key.length !== 1) return { preventDefault: false };
  // Closed, printable: change the value without opening (APG select-only).
  const { buffer, hit } = typed(c, key, selectedIndex);
  return {
    buffer,
    select: hit < 0 ? undefined : hit,
    activeIndex: hit < 0 ? state.activeIndex : hit,
  };
}

function openKey(c: Ctx, key: string): Step {
  const { options, alt } = c;
  const active = c.state.activeIndex;
  const go = (activeIndex: number): Step => ({ activeIndex });
  switch (key) {
    case 'ArrowDown':
    case 'ArrowUp':
      if (alt) return { open: false, select: pick(options, active) };
      return go(move(options, active, key === 'ArrowDown' ? 1 : -1));
    case 'Home':
      return go(firstEnabled(options));
    case 'End':
      return go(last(options));
    case 'PageDown':
      return go(move(options, active, PAGE));
    case 'PageUp':
      return go(move(options, active, -PAGE));
    case 'Enter':
    case ' ':
      return { open: false, select: pick(options, active) };
    case 'Escape':
      return { open: false, close: true };
    case 'Tab': // commit the active option and let focus move on
      return { open: false, select: pick(options, active), preventDefault: false };
  }
  if (key.length !== 1) return { preventDefault: false };
  const { buffer, hit } = typed(c, key, active);
  return { buffer, activeIndex: hit < 0 ? active : hit };
}

/** One key press -> next state plus an optional select/close intent. Pure apart from Date.now(). */
export function keyAction(state: KeyState, key: string, opts: KeyOpts): KeyResult {
  const now = Date.now();
  const c = { ...opts, alt: opts.alt ?? false, state, now };
  const step = state.open ? openKey(c, key) : closedKey(c, key);
  return {
    open: state.open,
    activeIndex: state.activeIndex,
    buffer: '',
    at: now,
    preventDefault: true,
    ...step,
  };
}

export type Rect = { top: number; bottom: number; left: number; width: number };
export type Placement = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  side: 'bottom' | 'top';
};
const MARGIN = 8;
const GAP = 4;

/**
 * Fixed coordinates for the popup. Below the trigger by default; above when it does not fit below
 * and there is more room above. Stays MARGIN inside the viewport. Width is the trigger's, or the
 * popup's own when wider.
 */
export function placePopup(
  trigger: Rect,
  popup: { width: number; height: number },
  viewport: { width: number; height: number },
): Placement {
  const width = Math.min(Math.max(trigger.width, popup.width), viewport.width - 2 * MARGIN);
  const left = Math.max(MARGIN, Math.min(trigger.left, viewport.width - MARGIN - width));
  const below = viewport.height - trigger.bottom - GAP - MARGIN;
  const above = trigger.top - GAP - MARGIN;
  const side = popup.height > below && above > below ? 'top' : 'bottom';
  const room = Math.max(0, side === 'top' ? above : below);
  const height = Math.min(popup.height, room);
  const top = side === 'top' ? trigger.top - GAP - height : trigger.bottom + GAP;
  return { top, left, width, maxHeight: room, side };
}

/**
 * Show `popup` in the top layer (Popover API, so no ancestor can clip it), place it by the trigger
 * and keep it placed on scroll and resize. `onOutside` fires on a pointer press outside both
 * elements (shadow-DOM safe). Returns the cleanup. Where `showPopover` is missing (jsdom) the popup
 * is simply positioned: fixed coordinates still apply.
 */
export function attachPopup(trigger: HTMLElement, popup: HTMLElement, onOutside: () => void) {
  if (typeof popup.showPopover === 'function' && !popup.matches(':popover-open'))
    popup.showPopover();
  const place = () => {
    popup.style.maxHeight = '';
    popup.style.width = 'max-content';
    const p = placePopup(
      trigger.getBoundingClientRect(),
      {
        width: popup.offsetWidth,
        height: popup.scrollHeight + (popup.offsetHeight - popup.clientHeight),
      },
      { width: window.innerWidth, height: window.innerHeight },
    );
    Object.assign(popup.style, {
      top: `${p.top}px`,
      left: `${p.left}px`,
      width: `${p.width}px`,
      maxHeight: `${p.maxHeight}px`,
    });
    popup.dataset.side = p.side;
  };
  const press = (e: Event) => {
    const path = e.composedPath();
    if (!path.includes(trigger) && !path.includes(popup)) onOutside();
  };
  place();
  addEventListener('scroll', place, true);
  addEventListener('resize', place);
  document.addEventListener('pointerdown', press, true);
  return () => {
    removeEventListener('scroll', place, true);
    removeEventListener('resize', place);
    document.removeEventListener('pointerdown', press, true);
    if (typeof popup.hidePopover === 'function' && popup.matches(':popover-open'))
      popup.hidePopover();
  };
}

/** A click on the label (by id, looked up in the trigger's own root) focuses the trigger. */
export function bindLabel(trigger: HTMLElement, labelId: string | undefined): () => void {
  const label = labelId
    ? (trigger.getRootNode() as Document | ShadowRoot).getElementById(labelId)
    : null;
  const focus = () => trigger.focus();
  label?.addEventListener('click', focus);
  return () => label?.removeEventListener('click', focus);
}

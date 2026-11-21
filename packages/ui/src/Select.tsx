import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import './tokens.css';
import './ds1.css';
import { attachPopup, bindLabel, keyAction, type SelectOption } from './select-core.ts';

type Props = {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  /** id of the element naming the select; clicking it focuses the trigger. */
  labelId?: string;
  'aria-label'?: string;
  id?: string;
  /** Renders a hidden input so the value posts with a form. */
  name?: string;
  disabled?: boolean;
};

export function Select({
  options,
  value,
  onChange,
  labelId,
  'aria-label': ariaLabel,
  id: given,
  name,
  disabled,
}: Props) {
  const generated = useId();
  const id = given ?? generated;
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;
  const trigger = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const typed = useRef({ buffer: '', at: 0 });
  const selected = options.findIndex((o) => o.value === value);

  useEffect(() => bindLabel(trigger.current!, labelId), [labelId]);

  useLayoutEffect(() => {
    if (!open) return;
    return attachPopup(trigger.current!, list.current!, () => setOpen(false));
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
  });

  const commit = (i: number) => {
    const o = options[i];
    if (o && !o.disabled && o.value !== value) onChange(o.value);
  };

  return (
    <div className="ds1-select" data-ds="select">
      <div
        ref={trigger}
        id={id}
        role="combobox"
        tabIndex={disabled ? -1 : 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(active) : undefined}
        aria-labelledby={labelId}
        aria-label={labelId ? undefined : ariaLabel}
        aria-disabled={disabled || undefined}
        className="ds1-select-trigger"
        onClick={() => {
          if (disabled) return;
          setActive(Math.max(selected, 0));
          setOpen(!open);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (disabled || e.ctrlKey || e.metaKey) return;
          const r = keyAction({ open, activeIndex: active, ...typed.current }, e.key, {
            options,
            selectedIndex: selected,
            alt: e.altKey,
          });
          typed.current = { buffer: r.buffer, at: r.at };
          if (r.preventDefault) e.preventDefault();
          setOpen(r.open);
          setActive(r.activeIndex);
          if (r.select !== undefined) commit(r.select);
        }}
      >
        <span className="ds1-select-value">{options[selected]?.label}</span>
      </div>
      {/* APG: focus stays on the trigger (aria-activedescendant), so list and options are not focusable. */}
      {/* eslint-disable jsx-a11y/interactive-supports-focus, jsx-a11y/click-events-have-key-events */}
      <div
        ref={list}
        id={listId}
        role="listbox"
        popover="manual"
        hidden={!open}
        aria-labelledby={labelId}
        aria-label={labelId ? undefined : ariaLabel}
        className="ds1-select-list"
        // keep focus on the trigger while the pointer works the list
        onMouseDown={(e) => e.preventDefault()}
      >
        {options.map((o, i) => (
          <div
            key={o.value}
            id={optionId(i)}
            role="option"
            aria-selected={i === selected}
            aria-disabled={o.disabled || undefined}
            data-active={open && i === active}
            className="ds1-select-option"
            onClick={() => {
              if (o.disabled) return;
              commit(i);
              setOpen(false);
              trigger.current?.focus();
            }}
          >
            {o.label}
          </div>
        ))}
      </div>
      {/* eslint-enable jsx-a11y/interactive-supports-focus, jsx-a11y/click-events-have-key-events */}
      {name && <input type="hidden" name={name} value={value} />}
    </div>
  );
}

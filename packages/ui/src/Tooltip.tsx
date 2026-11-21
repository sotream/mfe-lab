import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import './tokens.css';
import { attachPopup } from './select-core.ts';

type Props = Omit<HTMLAttributes<HTMLSpanElement>, 'content'> & {
  content: ReactNode;
  /** Makes the wrapper itself a tab stop (for text and icons). Leave off when `children` is focusable. */
  tabStop?: boolean;
};

const HOVER_MS = 300;

/**
 * Tooltip (WCAG 1.4.13): shows on hover after 300 ms and on focus at once; hides on pointer leave,
 * blur and Escape (focus stays). Hoverable: the pointer may cross onto the tooltip. The popup is in
 * the top layer, placed by `placePopup`. Import `@mfe/ui/tooltip.css`.
 */
export function Tooltip({ content, tabStop, children, ...rest }: Props) {
  const id = useId();
  const trigger = useRef<HTMLSpanElement>(null);
  const popup = useRef<HTMLSpanElement>(null);
  const timer = useRef<number>(undefined);
  const [open, setOpen] = useState(false);
  const hide = () => (clearTimeout(timer.current), setOpen(false));

  useLayoutEffect(() => {
    if (open) return attachPopup(trigger.current!, popup.current!, hide);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <span
      {...rest}
      ref={trigger}
      className={['ds1-tip', rest.className].filter(Boolean).join(' ')}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the tooltip trigger is the tab stop (WCAG 1.4.13)
      tabIndex={tabStop ? 0 : rest.tabIndex}
      aria-describedby={id}
      onFocus={() => (clearTimeout(timer.current), setOpen(true))}
      onBlur={hide}
      onPointerEnter={(e) => {
        if (e.pointerType === 'touch') return;
        clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setOpen(true), HOVER_MS);
      }}
      // the popup is a DOM child, so moving onto it is not a leave: it stays hoverable
      onPointerLeave={hide}
    >
      {children}
      <span
        ref={popup}
        id={id}
        role="tooltip"
        popover="manual"
        hidden={!open}
        className="ds1-tip-pop"
      >
        {content}
      </span>
    </span>
  );
}

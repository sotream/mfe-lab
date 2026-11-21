import './tokens.css';
import { Tooltip } from './Tooltip.tsx';

type Props = {
  text: string;
  /** Last N characters when a number; default: from the last `/`, else the last 12 characters. */
  tail?: string | number;
};

const FALLBACK = 12;

/**
 * One line, ellipsis in the middle, tail always visible (`https://host…/mf-manifest.json`). Pure
 * CSS. The visible pieces are aria-hidden (head + tail copy as the full text); a hidden span
 * carries the full text for screen readers; a tooltip shows it. The wrapper is always a tab stop
 * (it cannot cheaply know it is truncated). Import `@mfe/ui/tooltip.css`.
 */
export function MiddleTruncate({ text, tail }: Props) {
  const slash = text.lastIndexOf('/');
  const n =
    typeof tail === 'number'
      ? tail
      : typeof tail === 'string'
        ? tail.length
        : slash < 0 || text.length - slash > text.length / 2
          ? FALLBACK
          : text.length - slash;
  const cut = Math.max(0, text.length - n);
  return (
    <Tooltip tabStop content={text} className="ds1-trunc">
      <span aria-hidden="true" className="ds1-trunc-head">
        {text.slice(0, cut)}
      </span>
      <span aria-hidden="true" className="ds1-trunc-tail">
        {text.slice(cut)}
      </span>
      <span className="visually-hidden ds1-trunc-full">{text}</span>
    </Tooltip>
  );
}

import type { TableHTMLAttributes } from 'react';
import { Skeleton } from './Skeleton.tsx';
import './tokens.css';
import './ds1.css';

type Props = TableHTMLAttributes<HTMLTableElement> & {
  // Names the scroll region. Given, the wrapper is a focusable region so keyboard users can scroll it (WCAG 2.1.1).
  label?: string;
  // Renders `rows` skeleton rows of `cols` cells after `children` (pass the <thead> only), so the final column widths hold.
  // `rowHeight` (px) is the height of the real rows when they are taller than text, e.g. when they hold buttons.
  loading?: { rows: number; cols?: number; rowHeight?: number };
};

// Line widths cycle per column so the rows do not look stamped.
const WIDTHS = ['62%', '72%', '55%', '68%', '60%', '75%'];

export function Table({ className, label, loading, children, ...rest }: Props) {
  return (
    <div
      className="ds1-table-wrap"
      {...(label ? { role: 'region', tabIndex: 0, 'aria-label': label } : {})}
    >
      <table
        {...rest}
        {...(loading ? { 'aria-busy': true } : {})}
        data-ds="table"
        className={['ds1-table', className].filter(Boolean).join(' ')}
      >
        {label && <caption className="visually-hidden">{label}</caption>}
        {children}
        {loading && (
          <tbody>
            {Array.from({ length: loading.rows }, (_, r) => (
              <tr key={r} aria-hidden="true" style={{ height: loading.rowHeight }}>
                {Array.from({ length: loading.cols ?? 1 }, (_, c) => (
                  <td key={c} colSpan={loading.cols ? undefined : 99}>
                    <Skeleton width={WIDTHS[(c + r) % WIDTHS.length]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        )}
      </table>
    </div>
  );
}

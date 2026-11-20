import type { TableHTMLAttributes } from 'react';
import './tokens.css';
import './ds1.css';

type Props = TableHTMLAttributes<HTMLTableElement> & {
  // Names the scroll region. Given, the wrapper is a focusable region so keyboard users can scroll it (WCAG 2.1.1).
  label?: string;
};

export function Table({ className, label, ...rest }: Props) {
  return (
    <div
      className="ds1-table-wrap"
      {...(label ? { role: 'region', tabIndex: 0, 'aria-label': label } : {})}
    >
      <table
        {...rest}
        data-ds="table"
        className={['ds1-table', className].filter(Boolean).join(' ')}
      />
    </div>
  );
}

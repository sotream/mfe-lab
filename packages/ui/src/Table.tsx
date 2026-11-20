import type { TableHTMLAttributes } from 'react';
import './tokens.css';
import './ds1.css';

export function Table({ className, ...rest }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="ds1-table-wrap">
      <table
        {...rest}
        data-ds="table"
        className={['ds1-table', className].filter(Boolean).join(' ')}
      />
    </div>
  );
}

import type { ButtonHTMLAttributes } from 'react';
import './tokens.css';
import './ds1.css';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
};

export function Button({ variant = 'secondary', type = 'button', className, ...rest }: Props) {
  return (
    <button
      {...rest}
      type={type}
      data-ds="button"
      data-variant={variant}
      className={['ds1-button', `ds1-button--${variant}`, className].filter(Boolean).join(' ')}
    />
  );
}

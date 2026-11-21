import type { CSSProperties } from 'react';
import './tokens.css';
import './ds1.css';

type Props = {
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  radius?: CSSProperties['borderRadius'];
  className?: string;
  style?: CSSProperties;
};

// A decorative placeholder block. Pair it with a visually hidden role="status" text: it is not announced itself.
export function Skeleton({ width = '65%', height = '0.75rem', radius, className, style }: Props) {
  return (
    <span
      aria-hidden="true"
      className={['ds1-skeleton', className].filter(Boolean).join(' ')}
      style={{ width, height, ...(radius !== undefined && { borderRadius: radius }), ...style }}
    />
  );
}

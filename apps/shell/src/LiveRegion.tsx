import { on } from '@mfe/events';
import { useEffect, useRef } from 'react';

// The one polite live region of the page, fed by `a11y:announce` from any remote (RFC 0011).
// The text is written to the DOM node directly: React state would skip an identical message,
// and a synchronous clear is a real DOM mutation that screen readers notice.
export function LiveRegion() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const off = on('a11y:announce', ({ message }) => {
      if (ref.current) ref.current.textContent = '';
      // Next tick, so the clear and the set are separate mutations.
      const t = setTimeout(() => {
        timers.delete(t);
        if (ref.current) ref.current.textContent = message;
      }, 0);
      timers.add(t);
    });
    return () => {
      off();
      timers.forEach(clearTimeout);
    };
  }, []);
  return <div ref={ref} role="status" aria-live="polite" className="visually-hidden" />;
}

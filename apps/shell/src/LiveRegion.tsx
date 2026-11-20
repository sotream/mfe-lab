import { on } from '@mfe/events';
import { useEffect, useState } from 'react';

// The one polite live region of the page, fed by `a11y:announce` from any remote (RFC 0011).
export function LiveRegion() {
  const [message, setMessage] = useState('');
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const off = on('a11y:announce', ({ message: next }) => {
      // Clear, then set on the next tick, so an identical message is announced again.
      clearTimeout(timer);
      setMessage('');
      timer = setTimeout(() => setMessage(next), 0);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);
  return (
    <div role="status" aria-live="polite" className="visually-hidden">
      {message}
    </div>
  );
}

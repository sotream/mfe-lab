import { Link } from 'react-router';

// The mark: flask = lab, tab lip with the brand hyphen = micro frontends, two remotes in the flask.
export const Mark = () => (
  <svg
    className="mark"
    viewBox="0 0 64 64"
    width="22"
    height="22"
    aria-hidden="true"
    focusable="false"
  >
    <rect x="21" y="5" width="22" height="7" rx="3.5" fill="currentColor" />
    <rect x="27" y="7.6" width="10" height="1.8" rx=".9" fill="var(--ds1-accent)" />
    <path d="M27 14h10v10l8 13.8H19L27 24z" fill="currentColor" />
    <path d="M17.8 40H31v18H10.6a2.6 2.6 0 0 1-2.3-3.9z" fill="var(--ds1-cool)" />
    <path d="M33 40h13.2l9.5 14.1a2.6 2.6 0 0 1-2.3 3.9H33z" fill="var(--ds1-accent)" />
  </svg>
);

export const Wordmark = () => (
  <Link to="/" className="wordmark">
    <Mark />
    <span className="wordmark-text">
      mfe<span>-</span>lab
    </span>
  </Link>
);

import { login } from '@mfe/auth-store';
import { useAuth } from '@mfe/auth-store/react';
import { Button, Field } from '@mfe/ui';
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useT } from './messages.ts';
import { Wordmark } from './Wordmark.tsx';

// Only same-app paths: "/x" is fine, "//evil.test", "/\evil.test" and absolute URLs are not.
const safeNext = (next: string | null): string => (next && /^\/(?![/\\])/.test(next) ? next : '/');

export function LoginPage() {
  const t = useT().loginPage;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const loading = useAuth((s) => s.status === 'loading');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [needOtp, setNeedOtp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    try {
      await login(email, password, needOtp ? otp.trim() : undefined);
      navigate(safeNext(params.get('next')), { replace: true });
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'otp_required') setNeedOtp(true);
      const known: Record<string, string> = {
        otp_required: t.otpNeeded,
        invalid_credentials: t.invalid,
      };
      setError(known[code] ?? t.failed);
    }
  }

  return (
    <div className="login">
      <div className="login-intro">
        <Wordmark />
        <h1 tabIndex={-1}>{t.h1}</h1>
        <p className="lead">{t.lead}</p>
      </div>
      <div className="login-panel">
        <form onSubmit={submit} className="login-form">
          <Field
            label={t.email}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Field
            label={t.password}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {needOtp && (
            <Field
              label={t.otp}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              required
            />
          )}
          <Button type="submit" variant="primary" disabled={loading} className="login-submit">
            {t.submit}
          </Button>
          {error && <p role="alert">{error}</p>}
        </form>
        <div className="login-demo">
          <p>{t.demo}</p>
          <ul className="mono">
            <li>admin@lab.test</li>
            <li>editor@lab.test</li>
            <li>viewer@lab.test</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

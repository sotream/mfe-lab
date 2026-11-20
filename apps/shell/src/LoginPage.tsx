import { login, useAuth } from '@mfe/auth-store';
import { Button, Field } from '@mfe/ui';
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Wordmark } from './Wordmark.tsx';

// Only same-app paths: "/x" is fine, "//evil.test", "/\evil.test" and absolute URLs are not.
const safeNext = (next: string | null): string => (next && /^\/(?![/\\])/.test(next) ? next : '/');

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const loading = useAuth((s) => s.status === 'loading');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    try {
      await login(email, password);
      navigate(safeNext(params.get('next')), { replace: true });
    } catch (err) {
      setError(
        err instanceof Error && err.message === 'invalid_credentials'
          ? 'Invalid email or password'
          : 'Login failed, try again',
      );
    }
  }

  return (
    <div className="login">
      <div className="login-intro">
        <Wordmark />
        <h1>Sign in to the shell</h1>
        <p className="lead">
          The shell owns login. Both remotes read the same user from a shared store.
        </p>
      </div>
      <div className="login-panel">
        <form onSubmit={submit} className="login-form">
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Button type="submit" variant="primary" disabled={loading} className="login-submit">
            Sign in
          </Button>
          {error && <p role="alert">{error}</p>}
        </form>
        <div className="login-demo">
          <p>Demo accounts (demo-only, password lab12345):</p>
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

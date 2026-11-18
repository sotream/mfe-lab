import { login, useAuth } from '@mfe/auth-store';
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

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
    <>
      <h1>Login</h1>
      <form onSubmit={submit} className="login-form">
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={loading}>
          Sign in
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
      <p>Demo accounts (demo-only, password lab12345):</p>
      <ul>
        <li>admin@lab.test</li>
        <li>editor@lab.test</li>
        <li>viewer@lab.test</li>
      </ul>
    </>
  );
}

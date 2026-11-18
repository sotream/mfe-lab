import { useAuth } from '@mfe/auth-store';
import { useState } from 'react';

export default function DashboardPage() {
  const [n, setN] = useState(0);
  const user = useAuth((s) => s.user);
  return (
    <div>
      <p>hello from dashboard</p>
      <p>{user ? `signed in as ${user.email} (${user.role})` : 'not signed in'}</p>
      <button onClick={() => setN(n + 1)}>clicked {n} times</button>
    </div>
  );
}

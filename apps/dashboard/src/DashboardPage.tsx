import { useState } from 'react';

export default function DashboardPage() {
  const [n, setN] = useState(0);
  return (
    <div>
      <p>hello from dashboard</p>
      <button onClick={() => setN(n + 1)}>clicked {n} times</button>
    </div>
  );
}

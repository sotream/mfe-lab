import { useState } from 'react';

export default function ProductsPage() {
  const [n, setN] = useState(0);
  return (
    <div>
      <p>hello from products</p>
      <button onClick={() => setN(n + 1)}>clicked {n} times</button>
    </div>
  );
}

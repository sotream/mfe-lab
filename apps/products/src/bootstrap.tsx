import { login, useAuth } from '@mfe/auth-store';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import ProductsPage from './ProductsPage.tsx';

const ROLES = ['admin', 'editor', 'viewer'] as const;

// Only the standalone page renders this bar; inside the shell the user comes from its login.
function StandaloneBar() {
  const user = useAuth((s) => s.user);
  return (
    <div className="standalone-bar">
      <strong>Standalone dev</strong>
      <span>· sign in as:</span>
      {ROLES.map((role) => (
        <button key={role} onClick={() => login(`${role}@lab.test`, 'lab12345').catch(() => {})}>
          {role}
        </button>
      ))}
      <span>{user ? `signed in as ${user.email} (${user.role})` : 'not signed in'}</span>
    </div>
  );
}

function Standalone() {
  return (
    <>
      <StandaloneBar />
      <ProductsPage />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Standalone />
  </BrowserRouter>,
);

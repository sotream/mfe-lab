import { login, useAuth } from '@mfe/auth-store';
import { Button, detectLocale } from '@mfe/ui';
import '@mfe/ui/base.css';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { useT } from './messages.ts';
import ProductsApp from './ProductsApp.tsx';

document.documentElement.lang = detectLocale();

const ROLES = ['admin', 'editor', 'viewer'] as const;

// Only the standalone page renders this bar; inside the shell the user comes from its login.
function StandaloneBar() {
  const user = useAuth((s) => s.user);
  const t = useT().standalone;
  return (
    <div className="standalone-bar">
      <span className="standalone-title">{t.title}</span>
      {ROLES.map((role) => (
        <Button
          key={role}
          className="ds1-button--sm"
          onClick={() => login(`${role}@lab.test`, 'lab12345').catch(() => {})}
        >
          {role}
        </Button>
      ))}
      <span>{user ? t.signedIn(user.email, user.role) : t.signedOut}</span>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <StandaloneBar />
    <Routes>
      <Route path="/*" element={<ProductsApp />} />
    </Routes>
  </BrowserRouter>,
);

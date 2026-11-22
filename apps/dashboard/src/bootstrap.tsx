import { login } from '@mfe/auth-store';
import { useAuth } from '@mfe/auth-store/react';
import { Button, detectLocale } from '@mfe/ui';
import '@mfe/ui/base.css';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { useT } from './messages.ts';
import DashboardPage from './DashboardPage.tsx';

document.documentElement.lang = detectLocale();

const ROLES = ['admin', 'editor', 'viewer'] as const;

// Note: same bar as apps/products/src/bootstrap.tsx, duplicated (about 15 lines) so the two
// remotes stay independent; move it to @mfe/ui if a third remote needs it.
// Only the standalone page renders this bar; inside the shell the user comes from its login.
function StandaloneBar() {
  const user = useAuth((s) => s.user);
  const t = useT().standalone;
  return (
    <div className="dashboard-standalone-bar">
      <h1>{t.heading}</h1>
      <span className="dashboard-standalone-title">{t.title}</span>
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

function Standalone() {
  return (
    <>
      <StandaloneBar />
      <DashboardPage />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Standalone />
  </BrowserRouter>,
);

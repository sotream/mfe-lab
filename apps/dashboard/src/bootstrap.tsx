import { login, useAuth } from '@mfe/auth-store';
import { Button } from '@mfe/ui';
import '@mfe/ui/base.css';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import DashboardPage from './DashboardPage.tsx';

const ROLES = ['admin', 'editor', 'viewer'] as const;

// ponytail: same bar as apps/products/src/bootstrap.tsx, duplicated (about 15 lines) so the two
// remotes stay independent; move it to @mfe/ui if a third remote needs it.
// Only the standalone page renders this bar; inside the shell the user comes from its login.
function StandaloneBar() {
  const user = useAuth((s) => s.user);
  return (
    <div className="standalone-bar">
      <span className="standalone-title">Standalone dev. Sign in as</span>
      {ROLES.map((role) => (
        <Button
          key={role}
          className="ds1-button--sm"
          onClick={() => login(`${role}@lab.test`, 'lab12345').catch(() => {})}
        >
          {role}
        </Button>
      ))}
      <span>{user ? `signed in as ${user.email} (${user.role})` : 'not signed in'}</span>
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

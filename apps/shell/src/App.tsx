import { logout, useAuth } from '@mfe/auth-store';
import { report } from '@mfe/telemetry';
import { Button, RemoteFrame, useLocale, type Locale } from '@mfe/ui';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { createBrowserRouter, Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { DatenschutzPage, ImpressumPage } from './LegalPages.tsx';
import { LiveRegion } from './LiveRegion.tsx';
import InspectorPage from './InspectorPage.tsx';
import { LoginPage } from './LoginPage.tsx';
import { RequireAuth } from './RequireAuth.tsx';
import { Wordmark } from './Wordmark.tsx';
import { setLocale } from './locale.ts';
import { useT } from './messages.ts';
import { loadPage, remotePort, type RemoteName } from './remotes.ts';

declare const __BUILD_VERSION__: string;

const Remote = ({ name, module }: { name: RemoteName; module?: string }) => (
  <RemoteFrame
    // A new key per remote and module: a route change must not reuse the frame that loaded another remote.
    key={`${name}:${module ?? ''}`}
    name={name}
    port={remotePort(name)}
    load={() => loadPage(name, module)}
    report={report}
  />
);

// Page title per top-level route (key into the messages); a remote owns the title below its route (RFC 0011).
const TITLE_KEYS = {
  '': 'home',
  products: 'products',
  dashboard: 'dashboard',
  inspector: 'inspector',
  login: 'login',
  impressum: 'impressum',
  datenschutz: 'datenschutz',
} as const;

const LOCALES: Locale[] = ['de', 'en'];

function LanguageSwitch() {
  const t = useT();
  const current = useLocale();
  return (
    <div role="group" aria-label={t.language} className="lang-switch">
      {LOCALES.map((locale) => (
        <Button
          key={locale}
          className="ds1-button--sm"
          lang={locale}
          aria-pressed={current === locale}
          onClick={() => setLocale(locale)}
        >
          {locale.toUpperCase()}
        </Button>
      ))}
    </div>
  );
}

function Layout() {
  const user = useAuth((s) => s.user);
  const t = useT();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const firstRender = useRef(true);

  // Layout effect: runs before a remote's own effects, so ProductDetail's title wins.
  useLayoutEffect(() => {
    const key = TITLE_KEYS[(pathname.split('/')[1] ?? '') as keyof typeof TITLE_KEYS];
    if (key) document.title = `${t.titles[key]} – mfe-lab`;
  }, [pathname, t]);

  // Every navigation after the first render, back and forward included, moves focus to the h1.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    document.querySelector<HTMLElement>('main h1')?.focus();
  }, [pathname]);

  return (
    <>
      <a href="#main" className="skip-link">
        {t.skip}
      </a>
      <header className="topbar">
        <nav className="container">
          <Wordmark />
          <NavLink to="/" end>
            {t.nav.home}
          </NavLink>
          <NavLink to="/products">{t.nav.products}</NavLink>
          <NavLink to="/dashboard">{t.nav.dashboard}</NavLink>
          <NavLink to="/inspector">{t.nav.inspector}</NavLink>
          <LanguageSwitch />
          {user ? (
            <div className="nav-user">
              <span className="nav-email">{user.email}</span>
              <span className="chip chip--role">{user.role}</span>
              <Button
                onClick={() => {
                  navigate('/login');
                  logout();
                }}
              >
                {t.logout}
              </Button>
            </div>
          ) : (
            <NavLink to="/login" className="nav-user">
              {t.login}
            </NavLink>
          )}
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="container">
        <Outlet />
      </main>
      <LiveRegion />
      <footer className="container">
        <span>shell</span>
        <span className="mono build">{`build ${__BUILD_VERSION__}`}</span>
        <span className="footer-links">
          <Link to="/impressum">{t.footer.imprint}</Link>
          <Link to="/datenschutz">{t.footer.privacy}</Link>
        </span>
      </footer>
    </>
  );
}

function Heading({ k }: { k: 'products' | 'dashboard' }) {
  const t = useT();
  return (
    <div className="page-head">
      <h1 tabIndex={-1}>{t.nav[k]}</h1>
    </div>
  );
}

function Home() {
  const t = useT().home;
  return (
    <div className="page-head">
      <h1 tabIndex={-1}>{t.h1}</h1>
      <p className="lead">{t.lead}</p>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      {
        index: true,
        element: (
          <RequireAuth>
            <Home />
            <div className="frames">
              <Remote name="products" />
              <Remote name="dashboard" />
            </div>
          </RequireAuth>
        ),
      },
      {
        // The splat hands everything under /products to the remote's own routes (RFC 0007).
        path: 'products/*',
        element: (
          <RequireAuth>
            <Heading k="products" />
            <Remote name="products" module="ProductsApp" />
          </RequireAuth>
        ),
      },
      {
        path: 'dashboard',
        element: (
          <RequireAuth>
            <Heading k="dashboard" />
            <Remote name="dashboard" />
          </RequireAuth>
        ),
      },
      { path: 'inspector', element: <InspectorPage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'impressum', element: <ImpressumPage /> },
      { path: 'datenschutz', element: <DatenschutzPage /> },
    ],
  },
]);

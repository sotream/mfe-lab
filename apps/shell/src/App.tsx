import { logout } from '@mfe/auth-store';
import { useAuth } from '@mfe/auth-store/react';
import { report } from '@mfe/telemetry';
import { Button, RemoteFrame, useLocale, type Locale, type RemoteModule } from '@mfe/ui';
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createBrowserRouter, Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { DatenschutzPage, ImpressumPage } from './LegalPages.tsx';
import { fallbacks } from './Fallbacks.tsx';
import { LiveRegion } from './LiveRegion.tsx';
import InspectorPage from './InspectorPage.tsx';
import { LoginPage } from './LoginPage.tsx';
import { mountAdapter } from './MountAdapter.tsx';
import { RequireAuth } from './RequireAuth.tsx';
import { Wordmark } from './Wordmark.tsx';
import { setLocale } from './locale.ts';
import { useT } from './messages.ts';
import {
  loadMount,
  loadPage,
  RemoteDisabledError,
  remoteEntry,
  remoteOrigin,
  subscribeRemotes,
  type ExposedName,
  type RemoteName,
} from './remotes.ts';
import type { RemoteOfKind } from '../../../federation.contract.ts';

declare const __BUILD_VERSION__: string;

// Shown in the frame of a switched-off remote (RFC 0017): not an error, so no Retry and no report.
const Off = ({ name }: { name: string }) => <p role="status">{useT().remoteOff(name)}</p>;

const Frame = ({
  name,
  frameKey,
  load,
}: {
  name: RemoteName;
  frameKey: string;
  load: () => Promise<RemoteModule>;
}) => {
  // Follows the version selected in the inspector.
  const entry = useSyncExternalStore(subscribeRemotes, () => remoteEntry(name));
  return (
    <RemoteFrame
      // A new key per remote and module: a route change must not reuse the frame that loaded another remote.
      key={frameKey}
      name={name}
      origin={remoteOrigin(entry)}
      originTitle={new URL(entry).hostname}
      load={() =>
        load().catch((err: unknown) => {
          if (err instanceof RemoteDisabledError) return { default: () => <Off name={name} /> };
          throw err;
        })
      }
      report={report}
      fallback={fallbacks[name]}
    />
  );
};

const Remote = <R extends RemoteOfKind<'react'>>({
  name,
  module,
}: {
  name: R;
  module?: ExposedName<R>;
}) => (
  <Frame name={name} frameKey={`${name}:${module ?? ''}`} load={() => loadPage(name, module)} />
);

// A `mount`-kind remote (own framework, RFC 0016) goes through the adapter into the same frame.
const MountRemote = <R extends RemoteOfKind<'mount'>>({ name }: { name: R }) => (
  <Frame
    name={name}
    frameKey={name}
    load={() => loadMount(name).then((mod) => mountAdapter(name, mod))}
  />
);

// Page title per top-level route (key into the messages); a remote owns the title below its route (RFC 0011).
const TITLE_KEYS = {
  '': 'home',
  products: 'products',
  dashboard: 'dashboard',
  orders: 'orders',
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
        <div className="container">
          <Wordmark />
          <nav aria-label={t.mainNav}>
            <ul>
              <li>
                <NavLink to="/" end>
                  {t.nav.home}
                </NavLink>
              </li>
              <li>
                <NavLink to="/products">{t.nav.products}</NavLink>
              </li>
              <li>
                <NavLink to="/dashboard">{t.nav.dashboard}</NavLink>
              </li>
              <li>
                <NavLink to="/orders">{t.nav.orders}</NavLink>
              </li>
              <li>
                <NavLink to="/inspector">{t.nav.inspector}</NavLink>
              </li>
            </ul>
          </nav>
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
        </div>
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

function Heading({ k }: { k: 'products' | 'dashboard' | 'orders' }) {
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
      {
        path: 'orders',
        element: (
          <RequireAuth>
            <Heading k="orders" />
            <MountRemote name="orders" />
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

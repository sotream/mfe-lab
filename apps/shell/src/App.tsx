import { logout, useAuth } from '@mfe/auth-store';
import { report } from '@mfe/telemetry';
import { Button, RemoteFrame } from '@mfe/ui';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { createBrowserRouter, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { LiveRegion } from './LiveRegion.tsx';
import InspectorPage from './InspectorPage.tsx';
import { LoginPage } from './LoginPage.tsx';
import { RequireAuth } from './RequireAuth.tsx';
import { Wordmark } from './Wordmark.tsx';
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

// Page title per top-level route; a remote owns the title below its route (RFC 0011).
const TITLES: Record<string, string> = {
  '': 'Home',
  products: 'Products',
  dashboard: 'Dashboard',
  inspector: 'Inspector',
  login: 'Sign in',
};

function Layout() {
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const firstRender = useRef(true);

  // Layout effect: runs before a remote's own effects, so ProductDetail's title wins.
  useLayoutEffect(() => {
    const title = TITLES[pathname.split('/')[1] ?? ''];
    if (title) document.title = `${title} – mfe-lab`;
  }, [pathname]);

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
        Skip to content
      </a>
      <header className="topbar">
        <nav className="container">
          <Wordmark />
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/products">Products</NavLink>
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/inspector">Inspector</NavLink>
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
                Log out
              </Button>
            </div>
          ) : (
            <NavLink to="/login" className="nav-user">
              Login
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
      </footer>
    </>
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
            <div className="page-head">
              <h1 tabIndex={-1}>One page, three independent apps</h1>
              <p className="lead">
                The shell on :3000 loads products and dashboard at runtime. Each is built and
                deployed on its own.
              </p>
            </div>
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
            <div className="page-head">
              <h1 tabIndex={-1}>Products</h1>
            </div>
            <Remote name="products" module="ProductsApp" />
          </RequireAuth>
        ),
      },
      {
        path: 'dashboard',
        element: (
          <RequireAuth>
            <div className="page-head">
              <h1 tabIndex={-1}>Dashboard</h1>
            </div>
            <Remote name="dashboard" />
          </RequireAuth>
        ),
      },
      { path: 'inspector', element: <InspectorPage /> },
      { path: 'login', element: <LoginPage /> },
    ],
  },
]);

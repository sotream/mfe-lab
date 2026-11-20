import { logout, useAuth } from '@mfe/auth-store';
import { report } from '@mfe/telemetry';
import { Button, RemoteFrame } from '@mfe/ui';
import { createBrowserRouter, NavLink, Outlet, useNavigate } from 'react-router';
import InspectorPage from './InspectorPage.tsx';
import { LoginPage } from './LoginPage.tsx';
import { RequireAuth } from './RequireAuth.tsx';
import { Wordmark } from './Wordmark.tsx';
import { loadPage, remotePort, type RemoteName } from './remotes.ts';

declare const __BUILD_VERSION__: string;

const Remote = ({ name, module }: { name: RemoteName; module?: string }) => (
  <RemoteFrame
    name={name}
    port={remotePort(name)}
    load={() => loadPage(name, module)}
    report={report}
  />
);

function Layout() {
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  return (
    <>
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
      <main className="container">
        <Outlet />
      </main>
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
              <h1>One page, three independent apps</h1>
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
            <Remote name="products" module="ProductsApp" />
          </RequireAuth>
        ),
      },
      {
        path: 'dashboard',
        element: (
          <RequireAuth>
            <Remote name="dashboard" />
          </RequireAuth>
        ),
      },
      { path: 'inspector', element: <InspectorPage /> },
      { path: 'login', element: <LoginPage /> },
    ],
  },
]);

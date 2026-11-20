import { logout, useAuth } from '@mfe/auth-store';
import { RemoteFrame } from '@mfe/ui';
import { createBrowserRouter, NavLink, Outlet, useNavigate } from 'react-router';
import InspectorPage from './InspectorPage.tsx';
import { LoginPage } from './LoginPage.tsx';
import { RequireAuth } from './RequireAuth.tsx';
import { loadPage, remotePort, type RemoteName } from './remotes.ts';

declare const __BUILD_VERSION__: string;

const Remote = ({ name, module }: { name: RemoteName; module?: string }) => (
  <RemoteFrame name={name} port={remotePort(name)} load={() => loadPage(name, module)} />
);

function Layout() {
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  return (
    <>
      <nav>
        <NavLink to="/" end>
          Home
        </NavLink>
        <NavLink to="/products">Products</NavLink>
        <NavLink to="/dashboard">Dashboard</NavLink>
        <NavLink to="/inspector">Inspector</NavLink>
        {user ? (
          <>
            <span>{`${user.email} · ${user.role}`}</span>
            <button
              onClick={() => {
                navigate('/login');
                logout();
              }}
            >
              Log out
            </button>
          </>
        ) : (
          <NavLink to="/login">Login</NavLink>
        )}
      </nav>
      <main>
        <Outlet />
      </main>
      <footer>{`shell · build ${__BUILD_VERSION__}`}</footer>
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
            <h1>mfe-lab shell</h1>
            <Remote name="products" />
            <Remote name="dashboard" />
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

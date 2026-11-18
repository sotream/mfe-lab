import { logout, useAuth } from '@mfe/auth-store';
import { RemoteFrame } from '@mfe/ui';
import { createBrowserRouter, NavLink, Outlet, useNavigate } from 'react-router';
import { LoginPage } from './LoginPage.tsx';
import { RequireAuth } from './RequireAuth.tsx';
import { loadPage, remotePort, type RemoteName } from './remotes.ts';

const Remote = ({ name }: { name: RemoteName }) => (
  <RemoteFrame name={name} port={remotePort(name)} load={() => loadPage(name)} />
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
        path: 'products',
        element: (
          <RequireAuth>
            <Remote name="products" />
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
      { path: 'inspector', element: <h1>Inspector</h1> },
      { path: 'login', element: <LoginPage /> },
    ],
  },
]);

import { RemoteFrame } from '@mfe/ui';
import { createBrowserRouter, NavLink, Outlet } from 'react-router';
import { loadPage, remotePort, type RemoteName } from './remotes.ts';

const Remote = ({ name }: { name: RemoteName }) => (
  <RemoteFrame name={name} port={remotePort(name)} load={() => loadPage(name)} />
);

function Layout() {
  return (
    <>
      <nav>
        <NavLink to="/" end>
          Home
        </NavLink>
        <NavLink to="/products">Products</NavLink>
        <NavLink to="/dashboard">Dashboard</NavLink>
        <NavLink to="/inspector">Inspector</NavLink>
        <NavLink to="/login">Login</NavLink>
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
          <>
            <h1>mfe-lab shell</h1>
            <Remote name="products" />
            <Remote name="dashboard" />
          </>
        ),
      },
      { path: 'products', element: <Remote name="products" /> },
      { path: 'dashboard', element: <Remote name="dashboard" /> },
      { path: 'inspector', element: <h1>Inspector</h1> },
      { path: 'login', element: <h1>Login</h1> },
    ],
  },
]);

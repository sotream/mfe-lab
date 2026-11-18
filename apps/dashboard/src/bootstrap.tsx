import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import DashboardPage from './DashboardPage.tsx';

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <DashboardPage />
  </BrowserRouter>,
);

import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import ProductsPage from './ProductsPage.tsx';

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <ProductsPage />
  </BrowserRouter>,
);

import { Route, Routes } from 'react-router';
import { useAuth } from '@mfe/auth-store/react';
import ProductDetail from './ProductDetail.tsx';
import { ProductsContent, ProductsRoot } from './ProductsPage.tsx';

export { buildVersion } from './ProductsPage.tsx';

// Owns everything under the shell's `products/*`. One root for both routes, so the list's
// page, sort and search survive list -> detail -> back (RFC 0007).
export default function ProductsApp() {
  const userId = useAuth((s) => s.user?.id);
  return (
    <ProductsRoot key={userId ?? 'anonymous'}>
      <Routes>
        <Route index element={<ProductsContent base="" />} />
        <Route path=":id" element={<ProductDetail />} />
      </Routes>
    </ProductsRoot>
  );
}

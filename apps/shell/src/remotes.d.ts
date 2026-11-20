// Types for federated modules (MF dts generation is off, see RFC 0001).
declare module 'products/ProductsPage' {
  const ProductsPage: import('react').ComponentType;
  export const buildVersion: string;
  export default ProductsPage;
}

declare module 'dashboard/DashboardPage' {
  const DashboardPage: import('react').ComponentType;
  export const buildVersion: string;
  export default DashboardPage;
}

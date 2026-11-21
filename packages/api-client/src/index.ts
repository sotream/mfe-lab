import { getToken, logout } from '@mfe/auth-store';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

type Query = Record<string, string | number | undefined>;
type Options = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
};

function buildUrl(path: string, query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return `/api${path}${qs ? `?${qs}` : ''}`;
}

async function errorCode(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? 'http_error';
}

// Always calls the relative /api/...: every dev server proxies it to the API (no CORS needed).
export async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, 'network_error');
  }

  if (res.status === 401) {
    logout();
    throw new ApiError(401, 'unauthorized');
  }
  if (!res.ok) throw new ApiError(res.status, await errorCode(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type Product = {
  id: number;
  sku: string;
  name: string;
  price_cents: number;
  stock: number;
  created_at: string;
};
export type ProductInput = { sku: string; name: string; price_cents: number; stock: number };
export type Page<T> = { items: T[]; total: number; page: number; limit: number };
export type ProductQuery = {
  page?: number;
  limit?: number;
  sort?: 'id' | 'sku' | 'name' | 'price_cents' | 'stock' | 'created_at';
  order?: 'asc' | 'desc';
  q?: string;
};

export const listProducts = (query: ProductQuery) => request<Page<Product>>('/products', { query });
export const getProduct = (id: number) => request<Product>(`/products/${id}`);
export const createProduct = (input: ProductInput) =>
  request<Product>('/products', { method: 'POST', body: input });
export const updateProduct = (id: number, patch: Partial<ProductInput>) =>
  request<Product>(`/products/${id}`, { method: 'PATCH', body: patch });
export const deleteProduct = (id: number) => request<void>(`/products/${id}`, { method: 'DELETE' });

export type Stats = {
  counts: { products: number; orders: number };
  revenue_by_status: { new: number; paid: number; shipped: number };
  orders_per_day: { date: string; count: number }[];
};

export const getStats = () => request<Stats>('/stats');

export type ErrorRow = {
  id: number;
  remote: string;
  build: string;
  kind: 'render' | 'load' | 'unhandled';
  message: string;
  stack: string | null;
  url: string;
  at: string;
};

export const listErrors = () => request<ErrorRow[]>('/errors');
export const errorSummary = () => request<{ remote: string; count: number }[]>('/errors/summary');
export const clearErrors = () => request<void>('/errors', { method: 'DELETE' });

export type Flag = { name: string; enabled: boolean; description: string };

export const listFlags = () => request<Flag[]>('/flags');
export const setFlag = (name: string, enabled: boolean) =>
  request<Flag>(`/flags/${encodeURIComponent(name)}`, { method: 'PATCH', body: { enabled } });

// Remote registry (RFC 0017): public GET, admin-only PATCH.
export type RegistryRow = {
  name: string;
  canaryUrl: string | null;
  canaryPercent: number;
  disabled: boolean;
};
export type RegistryPatch = Partial<Omit<RegistryRow, 'name'>>;

export const getRegistry = () => request<RegistryRow[]>('/registry');
export const updateRegistry = (name: string, patch: RegistryPatch) =>
  request<RegistryRow>(`/registry/${encodeURIComponent(name)}`, { method: 'PATCH', body: patch });

export type OrderStatus = 'new' | 'paid' | 'shipped';
export type Order = {
  id: number;
  product_id: number;
  qty: number;
  status: OrderStatus;
  created_at: string;
};
export type OrderQuery = { page?: number; limit?: number; status?: OrderStatus };

// Newest first; `status` filters on the server.
export const listOrders = (query: OrderQuery) => request<Page<Order>>('/orders', { query });

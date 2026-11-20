import {
  ApiError,
  createProduct,
  deleteProduct,
  listProducts,
  updateProduct,
  type Page,
  type Product,
  type ProductInput,
} from '@mfe/api-client';
import { useAuth } from '@mfe/auth-store';
import { emit } from '@mfe/events';
import { Button, Field, Table } from '@mfe/ui';
import {
  keepPreviousData,
  QueryClient,
  notifyManager,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  centsToPriceInput,
  formatPrice,
  validateProductForm,
  type FormErrors,
  type FormValues,
} from './productForm.ts';
import { Link } from 'react-router';
import { Provider, useDispatch, useSelector } from 'react-redux';
import {
  closeDialogs,
  makeStore,
  openDelete,
  openEdit,
  openNew,
  selectListQuery,
  setPage,
  setQuery,
  setSort,
  type AppDispatch,
  type ListQuery,
  type RootState,
  type Sort,
} from './store.ts';
import './products.css';

const LIMIT = 10;

const useAppDispatch = useDispatch.withTypes<AppDispatch>();
const useAppSelector = useSelector.withTypes<RootState>();

const COLUMNS: { label: string; field: Sort }[] = [
  { label: 'SKU', field: 'sku' },
  { label: 'Name', field: 'name' },
  { label: 'Price', field: 'price_cents' },
  { label: 'Stock', field: 'stock' },
  { label: 'Created', field: 'created_at' },
];

// Native <dialog>, opened modally on mount. jsdom has no showModal, so fall back to `open`.
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }, []);
  return (
    <dialog ref={ref} className="products-dialog" aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  );
}

const FIELDS: { key: keyof FormValues; label: string; inputMode?: 'decimal' | 'numeric' }[] = [
  { key: 'sku', label: 'SKU' },
  { key: 'name', label: 'Name' },
  { key: 'price', label: 'Price', inputMode: 'decimal' },
  { key: 'stock', label: 'Stock', inputMode: 'numeric' },
];

function initialValues(product: Product | null): FormValues {
  if (!product) return { sku: '', name: '', price: '', stock: '' };
  return {
    sku: product.sku,
    name: product.name,
    price: centsToPriceInput(product.price_cents),
    stock: String(product.stock),
  };
}

function ProductDialog({
  product,
  onClose,
  onSave,
}: {
  product: Product | null;
  onClose: () => void;
  onSave: (input: ProductInput) => Promise<unknown>;
}) {
  const id = useId();
  const [values, setValues] = useState(() => initialValues(product));
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const result = validateProductForm(values);
    setErrors(result.errors);
    if (!result.input) return;
    setFailure(null);
    setSaving(true);
    try {
      await onSave(result.input);
    } catch (err) {
      setFailure(
        err instanceof ApiError && err.status === 409
          ? 'SKU already exists'
          : 'Could not save product',
      );
      setSaving(false);
    }
  }

  return (
    <Modal title={product ? 'Edit product' : 'Add product'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {FIELDS.map(({ key, label, inputMode }) => {
          return (
            <Field
              key={key}
              label={label}
              id={`${id}-${key}`}
              value={values[key]}
              inputMode={inputMode}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
              error={errors[key]}
            />
          );
        })}
        {failure && <p role="alert">{failure}</p>}
        <div className="products-dialog-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteDialog({
  product,
  onClose,
  onDelete,
}: {
  product: Product;
  onClose: () => void;
  onDelete: () => Promise<unknown>;
}) {
  const [failure, setFailure] = useState<string | null>(null);

  async function confirm() {
    try {
      await onDelete();
    } catch (err) {
      setFailure(
        err instanceof ApiError && err.status === 409
          ? 'Cannot delete: product has orders'
          : 'Could not delete product',
      );
    }
  }

  return (
    <Modal title={`Delete ${product.name}?`} onClose={onClose}>
      {failure && <p role="alert">{failure}</p>}
      <div className="products-dialog-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={confirm}>
          Delete
        </Button>
      </div>
    </Modal>
  );
}

function useProductList() {
  const dispatch = useAppDispatch();
  const query = useAppSelector(selectListQuery);
  const { data, isError, refetch } = useQuery({
    queryKey: ['products', query],
    queryFn: async () => {
      const list = (page: number) =>
        listProducts({
          page,
          limit: LIMIT,
          sort: query.sort,
          order: query.order,
          q: query.q || undefined,
        });
      const d = await list(query.page);
      // A page past the end (for example after a delete elsewhere) steps back to the last page.
      if (d.items.length === 0 && d.total > 0 && d.page > 1) {
        const last = Math.ceil(d.total / d.limit);
        dispatch(setPage(last));
        return list(last);
      }
      return d;
    },
    placeholderData: keepPreviousData,
  });

  return { query, data: data ?? null, failed: isError, reload: () => void refetch() };
}

// On success: refresh this remote's own cache, then tell the other remotes (RFC 0006).
function useProductMutations() {
  const client = useQueryClient();
  const changed = (id: number, kind: 'created' | 'updated' | 'deleted') => {
    void client.invalidateQueries({ queryKey: ['products'] });
    emit('products:changed', { id, kind });
  };
  const create = useMutation({
    mutationFn: createProduct,
    onSuccess: (p) => changed(p.id, 'created'),
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: number; input: ProductInput }) => updateProduct(id, input),
    onSuccess: (_, { id }) => changed(id, 'updated'),
  });
  const remove = useMutation({
    mutationFn: deleteProduct,
    onSuccess: (_, id) => changed(id, 'deleted'),
  });
  return { create, update, remove };
}

function ProductsTable({
  items,
  query,
  canWrite,
  base,
  onSort,
  onEdit,
  onDelete,
}: {
  items: Product[];
  query: ListQuery;
  canWrite: boolean;
  base: string;
  onSort: (field: Sort) => void;
  onEdit: (p: Product) => void;
  onDelete: (p: Product) => void;
}) {
  if (items.length === 0) return <p>No products found</p>;
  const ariaSort = (field: Sort) => {
    if (query.sort !== field) return undefined;
    return query.order === 'asc' ? 'ascending' : 'descending';
  };
  return (
    <Table>
      <thead>
        <tr>
          {COLUMNS.map(({ label, field }) => (
            <th key={field} aria-sort={ariaSort(field)}>
              <button onClick={() => onSort(field)}>{label}</button>
            </th>
          ))}
          {canWrite && <th>Actions</th>}
        </tr>
      </thead>
      <tbody>
        {items.map((p) => (
          <tr key={p.id}>
            <td>{p.sku}</td>
            <td>
              <Link to={`${base}${p.id}`}>{p.name}</Link>
            </td>
            <td>{formatPrice(p.price_cents)}</td>
            <td>{p.stock}</td>
            <td>{p.created_at.slice(0, 10)}</td>
            {canWrite && (
              <td>
                <Button aria-label={`Edit ${p.sku}`} onClick={() => onEdit(p)}>
                  Edit
                </Button>{' '}
                <Button variant="danger" aria-label={`Delete ${p.sku}`} onClick={() => onDelete(p)}>
                  Delete
                </Button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function Content({
  data,
  failed,
  onRetry,
  children,
}: {
  data: Page<Product> | null;
  failed: boolean;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (failed) {
    return (
      <div role="alert">
        <p>Could not load products</p>
        <Button onClick={onRetry}>Retry</Button>
      </div>
    );
  }
  if (!data) return <p role="status">Loading products…</p>;
  return children;
}

declare const __BUILD_VERSION__: string;
export const buildVersion: string = __BUILD_VERSION__;

// base is the link prefix to a detail page: '' inside ProductsApp (relative), '/products/' on Home.
export function ProductsContent({ base }: { base: string }) {
  const role = useAuth((s) => s.user?.role);
  const canWrite = role === 'admin' || role === 'editor';
  const [text, setText] = useState('');
  const dispatch = useAppDispatch();
  const editing = useAppSelector((s) => s.productsUi.editing);
  const deleting = useAppSelector((s) => s.productsUi.deleting);
  const { query, data, failed, reload } = useProductList();
  const { create, update, remove } = useProductMutations();

  // Debounce: one request 300 ms after the last keystroke; a new search goes back to page 1.
  useEffect(() => {
    const timer = setTimeout(() => {
      const q = text.trim();
      dispatch(setQuery(q));
    }, 300);
    return () => clearTimeout(timer);
  }, [text, dispatch]);

  // Deleting the only item on the last page steps back one page instead of showing an empty one.
  const afterDelete = () => {
    dispatch(closeDialogs());
    if (data?.items.length === 1 && query.page > 1) dispatch(setPage(query.page - 1));
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div className="products">
      <div className="products-toolbar">
        <input
          type="search"
          aria-label="Search"
          placeholder="Search name or SKU"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {canWrite && (
          <Button variant="primary" onClick={() => dispatch(openNew())}>
            Add product
          </Button>
        )}
      </div>

      <Content data={data} failed={failed} onRetry={reload}>
        <ProductsTable
          items={data?.items ?? []}
          query={query}
          canWrite={canWrite}
          base={base}
          onSort={(f) => dispatch(setSort(f))}
          onEdit={(p) => dispatch(openEdit(p))}
          onDelete={(p) => dispatch(openDelete(p))}
        />
        <div className="products-pager">
          <Button disabled={query.page <= 1} onClick={() => dispatch(setPage(query.page - 1))}>
            Previous
          </Button>
          <span>{`Page ${query.page} of ${pages}`}</span>
          <Button disabled={query.page >= pages} onClick={() => dispatch(setPage(query.page + 1))}>
            Next
          </Button>
        </div>
      </Content>

      {editing && (
        <ProductDialog
          product={editing === 'new' ? null : editing}
          onClose={() => dispatch(closeDialogs())}
          onSave={async (input) => {
            if (editing === 'new') await create.mutateAsync(input);
            else await update.mutateAsync({ id: editing.id, input });
            dispatch(closeDialogs());
          }}
        />
      )}
      {deleting && (
        <DeleteDialog
          product={deleting}
          onClose={() => dispatch(closeDialogs())}
          onDelete={async () => {
            await remove.mutateAsync(deleting.id);
            afterDelete();
          }}
        />
      )}
    </div>
  );
}

// Deliver cache updates in a microtask, not a macrotask: results render in the same tick as the fetch.
notifyManager.setScheduler(queueMicrotask);

// One QueryClient and one UI store per mount and per user: a user change remounts this, so no cache is shared.
// retry/refocus off keeps the explicit Retry button and today's behaviour.
export function ProductsRoot({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
      }),
  );
  const [store] = useState(makeStore);
  return (
    <Provider store={store}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </Provider>
  );
}

export default function ProductsPage() {
  const userId = useAuth((s) => s.user?.id);
  return (
    <ProductsRoot key={userId ?? 'anonymous'}>
      <ProductsContent base="/products/" />
    </ProductsRoot>
  );
}

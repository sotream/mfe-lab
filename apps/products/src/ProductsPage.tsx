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
import { Button, Field, formatDate, formatMoney, Table, useLocale, type Locale } from '@mfe/ui';
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
  validateProductForm,
  type FormErrors,
  type FormValues,
} from './productForm.ts';
import { Link } from 'react-router';
import { useFlag, useFlagsSync } from './flags.ts';
import { messages, useT } from './messages.ts';
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
import './telemetry.ts';

const LIMIT = 10;

const useAppDispatch = useDispatch.withTypes<AppDispatch>();
const useAppSelector = useSelector.withTypes<RootState>();

const COLUMNS: { label: keyof typeof messages.en.columns; field: Sort }[] = [
  { label: 'sku', field: 'sku' },
  { label: 'name', field: 'name' },
  { label: 'price', field: 'price_cents' },
  { label: 'stock', field: 'stock' },
  { label: 'created', field: 'created_at' },
];

// Native <dialog>, opened modally on mount. jsdom has no showModal, so fall back to `open`.
function Modal({
  title,
  onClose,
  returnTo,
  children,
}: {
  title: string;
  onClose: () => void;
  // Where focus goes on unmount instead of the opener (the opener may be gone).
  returnTo?: () => HTMLElement | null;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement as HTMLElement | null;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    // Closing by Save, Delete or Cancel unmounts the dialog, so the browser's own focus return
    // (which only runs on dialog.close()) never happens: do it here.
    return () => {
      const target = returnTo?.() ?? opener;
      if (target?.isConnected) target.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opener and returnTo are read once, on mount
  }, []);
  return (
    <dialog ref={ref} className="products-dialog" aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  );
}

const FIELDS: { key: keyof FormValues; inputMode?: 'decimal' | 'numeric' }[] = [
  { key: 'sku' },
  { key: 'name' },
  { key: 'price', inputMode: 'decimal' },
  { key: 'stock', inputMode: 'numeric' },
];

function initialValues(product: Product | null, locale: Locale): FormValues {
  if (!product) return { sku: '', name: '', price: '', stock: '' };
  return {
    sku: product.sku,
    name: product.name,
    price: centsToPriceInput(product.price_cents, locale),
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
  const t = useT();
  const locale = useLocale();
  const [values, setValues] = useState(() => initialValues(product, locale));
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const result = validateProductForm(values, t);
    setErrors(result.errors);
    if (!result.input) return;
    setFailure(null);
    setSaving(true);
    try {
      await onSave(result.input);
    } catch (err) {
      setFailure(err instanceof ApiError && err.status === 409 ? t.skuExists : t.saveFailed);
      setSaving(false);
    }
  }

  return (
    <Modal title={product ? t.edit : t.add} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {FIELDS.map(({ key, inputMode }) => {
          return (
            <Field
              key={key}
              label={t.columns[key]}
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
          <Button onClick={onClose}>{t.cancel}</Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {t.save}
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
  returnTo,
}: {
  product: Product;
  onClose: () => void;
  onDelete: () => Promise<unknown>;
  returnTo: () => HTMLElement | null;
}) {
  const t = useT();
  const [failure, setFailure] = useState<string | null>(null);

  async function confirm() {
    try {
      await onDelete();
    } catch (err) {
      setFailure(
        err instanceof ApiError && err.status === 409 ? t.deleteHasOrders : t.deleteFailed,
      );
    }
  }

  return (
    <Modal title={t.deleteTitle(product.name)} onClose={onClose} returnTo={returnTo}>
      {failure && <p role="alert">{failure}</p>}
      <div className="products-dialog-actions">
        <Button onClick={onClose}>{t.cancel}</Button>
        <Button variant="danger" onClick={confirm}>
          {t.deleteBtn}
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
  const t = useT();
  const changed = (id: number, kind: 'created' | 'updated' | 'deleted', sku: string) => {
    void client.invalidateQueries({ queryKey: ['products'] });
    emit('products:changed', { id, kind });
    // The shell owns the live region (RFC 0011); standalone nobody listens.
    emit('a11y:announce', { message: t.announce(sku, kind) });
  };
  const create = useMutation({
    mutationFn: createProduct,
    onSuccess: (p) => changed(p.id, 'created', p.sku),
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: number; input: ProductInput }) => updateProduct(id, input),
    onSuccess: (_, { id, input }) => changed(id, 'updated', input.sku),
  });
  const remove = useMutation({
    mutationFn: (p: Product) => deleteProduct(p.id),
    onSuccess: (_, p) => changed(p.id, 'deleted', p.sku),
  });
  return { create, update, remove };
}

function ProductsTable({
  items,
  query,
  canWrite,
  base,
  detailLinks,
  onSort,
  onEdit,
  onDelete,
}: {
  items: Product[];
  query: ListQuery;
  canWrite: boolean;
  base: string;
  detailLinks: boolean;
  onSort: (field: Sort) => void;
  onEdit: (p: Product) => void;
  onDelete: (p: Product) => void;
}) {
  const t = useT();
  const locale = useLocale();
  if (items.length === 0) return <p>{t.none}</p>;
  const ariaSort = (field: Sort) => {
    if (query.sort !== field) return undefined;
    return query.order === 'asc' ? 'ascending' : 'descending';
  };
  return (
    <div className="products-table">
      <Table label={t.table}>
        <thead>
          <tr>
            {COLUMNS.map(({ label, field }) => (
              <th
                key={field}
                aria-sort={ariaSort(field)}
                className={field === 'price_cents' || field === 'stock' ? 'ds1-num' : undefined}
              >
                <button onClick={() => onSort(field)}>{t.columns[label]}</button>
              </th>
            ))}
            {canWrite && <th className="products-actions-head">{t.actions}</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id}>
              <td className="ds1-mono">{p.sku}</td>
              <td>{detailLinks ? <Link to={`${base}${p.id}`}>{p.name}</Link> : p.name}</td>
              <td className="ds1-num">{formatMoney(p.price_cents, locale)}</td>
              <td className="ds1-num">{p.stock}</td>
              <td className="ds1-mono products-created">{formatDate(p.created_at, locale)}</td>
              {canWrite && (
                <td>
                  <div className="products-actions">
                    <Button
                      className="ds1-button--sm"
                      aria-label={t.editSku(p.sku)}
                      onClick={() => onEdit(p)}
                    >
                      {t.editBtn}
                    </Button>
                    <Button
                      className="ds1-button--sm"
                      variant="danger"
                      aria-label={t.deleteSku(p.sku)}
                      onClick={() => onDelete(p)}
                    >
                      {t.deleteBtn}
                    </Button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
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
  const t = useT();
  if (failed) {
    return (
      <div role="alert">
        <p>{t.loadFailed}</p>
        <Button onClick={onRetry}>{t.retry}</Button>
      </div>
    );
  }
  if (!data) return <p role="status">{t.loadingProducts}</p>;
  return children;
}

// Error tracking demo: throws on render while the products.crash flag is on.
function CrashWhenFlagged() {
  if (useFlag('products.crash', false)) throw new Error('products.crash flag is on');
  return null;
}

declare const __BUILD_VERSION__: string;
export const buildVersion: string = __BUILD_VERSION__;

// base is the link prefix to a detail page: '' inside ProductsApp (relative), '/products/' on Home.
export function ProductsContent({ base }: { base: string }) {
  const t = useT();
  const role = useAuth((s) => s.user?.role);
  const canWrite = role === 'admin' || role === 'editor';
  const [text, setText] = useState('');
  const dispatch = useAppDispatch();
  const editing = useAppSelector((s) => s.productsUi.editing);
  const deleting = useAppSelector((s) => s.productsUi.deleting);
  const { query, data, failed, reload } = useProductList();
  const { create, update, remove } = useProductMutations();
  const toolbar = useRef<HTMLDivElement>(null);
  const deleted = useRef(false);
  useFlagsSync();
  const detailLinks = useFlag('products.detailPage', true);

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
      <CrashWhenFlagged />
      <div className="products-toolbar" ref={toolbar}>
        <input
          type="search"
          className="ds1-input"
          aria-label={t.search}
          placeholder={t.searchPlaceholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {canWrite && (
          <Button variant="primary" onClick={() => dispatch(openNew())}>
            {t.add}
          </Button>
        )}
      </div>

      <Content data={data} failed={failed} onRetry={reload}>
        <ProductsTable
          items={data?.items ?? []}
          query={query}
          canWrite={canWrite}
          base={base}
          detailLinks={detailLinks}
          onSort={(f) => dispatch(setSort(f))}
          onEdit={(p) => dispatch(openEdit(p))}
          onDelete={(p) => {
            deleted.current = false;
            dispatch(openDelete(p));
          }}
        />
        <div className="products-pager">
          <Button disabled={query.page <= 1} onClick={() => dispatch(setPage(query.page - 1))}>
            {t.previous}
          </Button>
          <span>{t.pageOf(query.page, pages)}</span>
          <Button disabled={query.page >= pages} onClick={() => dispatch(setPage(query.page + 1))}>
            {t.next}
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
          // The deleted row's button is gone, so focus goes to Add product.
          returnTo={() =>
            deleted.current ? (toolbar.current?.querySelector('button') ?? null) : null
          }
          onDelete={async () => {
            await remove.mutateAsync(deleting);
            deleted.current = true;
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

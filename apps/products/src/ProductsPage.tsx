import {
  ApiError,
  createProduct,
  deleteProduct,
  listProducts,
  updateProduct,
  type Page,
  type Product,
  type ProductQuery,
} from '@mfe/api-client';
import { useAuth } from '@mfe/auth-store';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  centsToPriceInput,
  formatPrice,
  validateProductForm,
  type FormErrors,
  type FormValues,
} from './productForm.ts';
import './products.css';

const LIMIT = 10;

type Sort = NonNullable<ProductQuery['sort']>;
type Query = { page: number; sort: Sort; order: 'asc' | 'desc'; q: string };

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
  onSaved,
}: {
  product: Product | null;
  onClose: () => void;
  onSaved: () => void;
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
      if (product) await updateProduct(product.id, result.input);
      else await createProduct(result.input);
      onSaved();
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
          const error = errors[key];
          return (
            <div key={key}>
              <label htmlFor={`${id}-${key}`}>{label}</label>
              <input
                id={`${id}-${key}`}
                value={values[key]}
                inputMode={inputMode}
                onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-${key}-error` : undefined}
              />
              {error && (
                <p id={`${id}-${key}-error`} className="products-field-error">
                  {error}
                </p>
              )}
            </div>
          );
        })}
        {failure && <p role="alert">{failure}</p>}
        <div className="products-dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={saving}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteDialog({
  product,
  onClose,
  onDeleted,
}: {
  product: Product;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [failure, setFailure] = useState<string | null>(null);

  async function confirm() {
    try {
      await deleteProduct(product.id);
      onDeleted();
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
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" onClick={confirm}>
          Delete
        </button>
      </div>
    </Modal>
  );
}

// Last query wins: a response for a superseded query is ignored.
function useProductList() {
  const [query, setQuery] = useState<Query>({ page: 1, sort: 'id', order: 'asc', q: '' });
  const [data, setData] = useState<Page<Product> | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let stale = false;
    listProducts({
      page: query.page,
      limit: LIMIT,
      sort: query.sort,
      order: query.order,
      q: query.q || undefined,
    })
      .then((d) => {
        if (stale) return;
        // A page past the end (for example after a delete elsewhere) steps back to the last page.
        if (d.items.length === 0 && d.total > 0 && d.page > 1) {
          setQuery((p) => ({ ...p, page: Math.ceil(d.total / d.limit) }));
          return;
        }
        setFailed(false);
        setData(d);
      })
      .catch(() => {
        if (!stale) setFailed(true);
      });
    return () => {
      stale = true;
    };
  }, [query, reloadKey]);

  return {
    query,
    setQuery,
    data,
    failed,
    reload: () => {
      setFailed(false);
      setReloadKey((k) => k + 1);
    },
  };
}

function ProductsTable({
  items,
  query,
  canWrite,
  onSort,
  onEdit,
  onDelete,
}: {
  items: Product[];
  query: Query;
  canWrite: boolean;
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
    <table>
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
            <td>{p.name}</td>
            <td>{formatPrice(p.price_cents)}</td>
            <td>{p.stock}</td>
            <td>{p.created_at.slice(0, 10)}</td>
            {canWrite && (
              <td>
                <button aria-label={`Edit ${p.sku}`} onClick={() => onEdit(p)}>
                  Edit
                </button>{' '}
                <button aria-label={`Delete ${p.sku}`} onClick={() => onDelete(p)}>
                  Delete
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
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
        <button onClick={onRetry}>Retry</button>
      </div>
    );
  }
  if (!data) return <p role="status">Loading products…</p>;
  return children;
}

declare const __BUILD_VERSION__: string;
export const buildVersion: string = __BUILD_VERSION__;

export default function ProductsPage() {
  const role = useAuth((s) => s.user?.role);
  const canWrite = role === 'admin' || role === 'editor';
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const { query, setQuery, data, failed, reload } = useProductList();

  // Debounce: one request 300 ms after the last keystroke; a new search goes back to page 1.
  useEffect(() => {
    const timer = setTimeout(() => {
      const q = text.trim();
      setQuery((p) => (p.q === q ? p : { ...p, q, page: 1 }));
    }, 300);
    return () => clearTimeout(timer);
  }, [text, setQuery]);

  const sortBy = (field: Sort) =>
    setQuery((p) =>
      p.sort === field
        ? { ...p, order: p.order === 'asc' ? 'desc' : 'asc', page: 1 }
        : { ...p, sort: field, order: 'asc', page: 1 },
    );

  // Deleting the only item on the last page steps back one page instead of showing an empty one.
  const afterDelete = () => {
    setDeleting(null);
    if (data?.items.length === 1 && query.page > 1) {
      setQuery((p) => ({ ...p, page: p.page - 1 }));
    } else {
      reload();
    }
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
        {canWrite && <button onClick={() => setEditing('new')}>Add product</button>}
      </div>

      <Content data={data} failed={failed} onRetry={reload}>
        <ProductsTable
          items={data?.items ?? []}
          query={query}
          canWrite={canWrite}
          onSort={sortBy}
          onEdit={setEditing}
          onDelete={setDeleting}
        />
        <div className="products-pager">
          <button
            disabled={query.page <= 1}
            onClick={() => setQuery((p) => ({ ...p, page: p.page - 1 }))}
          >
            Previous
          </button>
          <span>{`Page ${query.page} of ${pages}`}</span>
          <button
            disabled={query.page >= pages}
            onClick={() => setQuery((p) => ({ ...p, page: p.page + 1 }))}
          >
            Next
          </button>
        </div>
      </Content>

      {editing && (
        <ProductDialog
          product={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {deleting && (
        <DeleteDialog
          product={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={afterDelete}
        />
      )}
    </div>
  );
}

import { ApiError, getProduct } from '@mfe/api-client';
import { Button } from '@mfe/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { formatPrice } from './productForm.ts';

export default function ProductDetail() {
  const { id: raw = '' } = useParams();
  const valid = /^[1-9]\d*$/.test(raw);
  const id = Number(raw);
  const { data, error, refetch } = useQuery({
    queryKey: ['product', id],
    queryFn: () => getProduct(id),
    enabled: valid,
  });

  const notFound = !valid || (error instanceof ApiError && error.status === 404);
  // The remote owns the title of its subtree; the shell sets "Products – mfe-lab" on navigation (RFC 0011).
  const title = notFound ? 'Product not found' : data?.name;
  useEffect(() => {
    if (title) document.title = `${title} – Products – mfe-lab`;
  }, [title]);

  let body;
  if (notFound) {
    body = <p>Product not found</p>;
  } else if (error) {
    body = (
      <div role="alert">
        <p>Could not load product</p>
        <Button onClick={() => void refetch()}>Retry</Button>
      </div>
    );
  } else if (!data) {
    body = <p role="status">Loading…</p>;
  } else {
    body = (
      <>
        <h3 className="product-name">{data.name}</h3>
        <dl className="ds1-readings product-readings">
          <div>
            <dt>SKU</dt>
            <dd>{data.sku}</dd>
          </div>
          <div className="price">
            <dt>Price</dt>
            <dd>{formatPrice(data.price_cents)}</dd>
          </div>
          <div>
            <dt>Stock</dt>
            <dd>{data.stock}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{data.created_at.slice(0, 10)}</dd>
          </div>
        </dl>
      </>
    );
  }
  return (
    <div className="products">
      <Link to=".." className="product-back">
        Back to products
      </Link>
      {body}
    </div>
  );
}

import { ApiError, getProduct } from '@mfe/api-client';
import { Button } from '@mfe/ui';
import { useQuery } from '@tanstack/react-query';
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

  let body;
  if (!valid || (error instanceof ApiError && error.status === 404)) {
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
        <h2 className="product-name">{data.name}</h2>
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

import { ApiError, getProduct } from '@mfe/api-client';
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
        <button onClick={() => void refetch()}>Retry</button>
      </div>
    );
  } else if (!data) {
    body = <p role="status">Loading…</p>;
  } else {
    body = (
      <>
        <h2>{data.name}</h2>
        <dl>
          <dt>SKU</dt>
          <dd>{data.sku}</dd>
          <dt>Price</dt>
          <dd>{formatPrice(data.price_cents)}</dd>
          <dt>Stock</dt>
          <dd>{data.stock}</dd>
          <dt>Created</dt>
          <dd>{data.created_at.slice(0, 10)}</dd>
        </dl>
      </>
    );
  }
  return (
    <div className="products">
      <p>
        <Link to="..">Back to products</Link>
      </p>
      {body}
    </div>
  );
}

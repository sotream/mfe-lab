import { ApiError, getProduct } from '@mfe/api-client';
import { Button, formatDate, formatMoney, formatNumber, useLocale } from '@mfe/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { useT } from './messages.ts';

export default function ProductDetail() {
  const t = useT();
  const locale = useLocale();
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
  const title = notFound ? t.notFound : data?.name;
  useEffect(() => {
    if (title) document.title = t.detailTitle(title);
  }, [title, t]);

  let body;
  if (notFound) {
    body = <p>{t.notFound}</p>;
  } else if (error) {
    body = (
      <div role="alert">
        <p>{t.detailFailed}</p>
        <Button onClick={() => void refetch()}>{t.retry}</Button>
      </div>
    );
  } else if (!data) {
    body = <p role="status">{t.loading}</p>;
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
            <dt>{t.columns.price}</dt>
            <dd>
              {formatMoney(data.price_cents, locale)}
              <small className="vat">{t.vat}</small>
            </dd>
          </div>
          <div>
            <dt>{t.columns.stock}</dt>
            <dd>{formatNumber(data.stock, locale)}</dd>
          </div>
          <div>
            <dt>{t.columns.created}</dt>
            <dd>{formatDate(data.created_at, locale)}</dd>
          </div>
        </dl>
      </>
    );
  }
  return (
    <div className="products">
      <Link to=".." className="product-back">
        {t.back}
      </Link>
      {body}
    </div>
  );
}

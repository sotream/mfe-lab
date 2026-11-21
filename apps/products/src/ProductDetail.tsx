import { ApiError, getProduct } from '@mfe/api-client';
import { Button, formatDate, formatMoney, formatNumber, Skeleton, useLocale } from '@mfe/ui';
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
    body = (
      <>
        <p role="status" className="visually-hidden">
          {t.loading}
        </p>
        <h3 className="products-name" aria-hidden="true">
          <Skeleton width="40%" height="0.8em" />
        </h3>
        <dl className="ds1-readings products-readings" aria-hidden="true">
          {[
            [t.columns.sku, '70%'],
            [t.columns.price, '60%'],
            [t.columns.stock, '45%'],
            [t.columns.created, '75%'],
          ].map(([label, width], i) => (
            <div key={label} className={i === 1 ? 'price' : undefined}>
              <dt>{label}</dt>
              <dd>
                <Skeleton width={width} height="0.8em" />
                {i === 1 && <small className="vat">&nbsp;</small>}
              </dd>
            </div>
          ))}
        </dl>
      </>
    );
  } else {
    body = (
      <>
        <h3 className="products-name">{data.name}</h3>
        <dl className="ds1-readings products-readings">
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
            <dd>
              <time dateTime={data.created_at.slice(0, 10)}>
                {formatDate(data.created_at, locale)}
              </time>
            </dd>
          </div>
        </dl>
      </>
    );
  }
  return (
    <div className="products">
      <Link to=".." className="products-back">
        {t.back}
      </Link>
      {body}
    </div>
  );
}

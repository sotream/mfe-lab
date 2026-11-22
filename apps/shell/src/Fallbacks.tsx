import { canWrite as canWriteUser } from '@mfe/auth-store';
import { useAuth } from '@mfe/auth-store/react';
import { Skeleton, Table } from '@mfe/ui';
import type { ReactNode } from 'react';
import './fallbacks.css';

// What a frame shows while its remote loads: the remote's first view as skeleton blocks of the same size.
// Approximations by design (the shell cannot import remote code): heights are checked in the e2e.

const head = (cols: number) => (
  <thead>
    <tr>
      {Array.from({ length: cols }, (_, i) => (
        <th key={i} scope="col">
          <Skeleton width="50%" />
        </th>
      ))}
    </tr>
  </thead>
);

function ProductsFallback() {
  const canWrite = useAuth((s) => canWriteUser(s.user));
  return (
    <div className="fb">
      <div className="fb-toolbar">
        <Skeleton width="22rem" height={36} />
        {canWrite && <Skeleton width={118} height={36} />}
      </div>
      <Table loading={{ rows: 10, cols: canWrite ? 6 : 5, rowHeight: canWrite ? 47 : undefined }}>
        {head(canWrite ? 6 : 5)}
      </Table>
      <div className="fb-pager">
        <Skeleton width={72} height={36} />
        <Skeleton width={80} />
        <Skeleton width={72} height={36} />
      </div>
    </div>
  );
}

function DashboardFallback() {
  return (
    <div className="fb fb-dashboard">
      <dl className="ds1-readings fb-tiles">
        {['35%', '40%', '60%', '55%'].map((w, i) => (
          <div key={i}>
            <dt>
              <Skeleton width="50%" />
            </dt>
            <dd>
              <Skeleton width={w} height="0.8em" />
            </dd>
          </div>
        ))}
      </dl>
      <div className="fb-block">
        <div className="fb-title">
          <Skeleton width="30%" height="1rem" />
        </div>
        <Skeleton className="fb-chart" width="100%" height="auto" />
      </div>
      <div className="fb-block">
        <div className="fb-title fb-title--h3">
          <Skeleton width="30%" height="1rem" />
        </div>
        {[70, 100, 45].map((w, i) => (
          <div key={i} className="fb-bar">
            <Skeleton width="60%" />
            <span>
              <Skeleton width={`${w}%`} height="100%" radius="0 4px 4px 0" />
            </span>
            <Skeleton width="70%" />
          </div>
        ))}
      </div>
      <div className="fb-details" />
    </div>
  );
}

function OrdersFallback() {
  return (
    <div className="fb fb-orders">
      <div className="fb-toolbar">
        <Skeleton width={48} />
        <Skeleton width={120} height={36} />
      </div>
      <Table loading={{ rows: 10, cols: 6, rowHeight: 41.4 }}>{head(6)}</Table>
      <div className="fb-pager">
        <Skeleton width={72} height={30} />
        <Skeleton width={80} />
        <Skeleton width={72} height={30} />
      </div>
    </div>
  );
}

export const fallbacks: Record<string, ReactNode> = {
  products: <ProductsFallback />,
  dashboard: <DashboardFallback />,
  orders: <OrdersFallback />,
};

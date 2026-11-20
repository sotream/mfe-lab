import { getStats, type Stats } from '@mfe/api-client';
import { useAuth } from '@mfe/auth-store';
import { on } from '@mfe/events';
import { Button, Table } from '@mfe/ui';
import {
  notifyManager,
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { fillDays, formatCents, niceMax, totalRevenue, yTicks } from './stats.ts';
import './dashboard.css';

type Day = { date: string; count: number };

// Chart geometry (SVG user units; the viewBox scales it to the container).
const MARGIN = { top: 8, right: 8, bottom: 24, left: 36 };
const PLOT_H = 160;
const MIN_PLOT_W = 480;
const MIN_SLOT = 22;
const MAX_BAR = 24;
const GAP = 2;

function useStats() {
  const client = useQueryClient();
  const { data, isError, refetch } = useQuery({ queryKey: ['stats'], queryFn: getStats });

  // Another remote changed products: our own stats are stale (RFC 0006).
  useEffect(
    () => on('products:changed', () => void client.invalidateQueries({ queryKey: ['stats'] })),
    [client],
  );

  return { stats: data ?? null, failed: isError, reload: () => void refetch() };
}

function Tiles({ stats }: { stats: Stats }) {
  const tiles = [
    ['Products', String(stats.counts.products)],
    ['Orders', String(stats.counts.orders)],
    ['Revenue', formatCents(totalRevenue(stats.revenue_by_status))],
    ['Paid revenue', formatCents(stats.revenue_by_status.paid)],
  ];
  return (
    <dl className="dashboard-tiles">
      {tiles.map(([term, value]) => (
        <div key={term} className="dashboard-tile">
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// First, middle and last date only: enough orientation, no label collisions.
function labelIndices(n: number): number[] {
  if (n < 3) return n === 2 ? [0, 1] : [0];
  return [0, Math.floor((n - 1) / 2), n - 1];
}

function anchorFor(i: number, n: number): 'start' | 'middle' | 'end' {
  if (n < 2) return 'middle';
  if (i === 0) return 'start';
  return i === n - 1 ? 'end' : 'middle';
}

function OrdersChart({ days }: { days: Day[] }) {
  const [active, setActive] = useState<Day | null>(null);
  const max = Math.max(...days.map((d) => d.count));
  const top = niceMax(max);
  const plotW = Math.max(MIN_PLOT_W, days.length * MIN_SLOT);
  const slot = plotW / days.length;
  const barW = Math.min(MAX_BAR, slot - GAP);
  const width = MARGIN.left + plotW + MARGIN.right;
  const height = MARGIN.top + PLOT_H + MARGIN.bottom;
  const baseline = MARGIN.top + PLOT_H;
  const first = days[0]!.date;
  const last = days[days.length - 1]!.date;

  const geometry = (i: number, count: number) => {
    const h = (count / top) * PLOT_H;
    return { x: MARGIN.left + i * slot + (slot - barW) / 2, y: baseline - h, h };
  };
  const activeIndex = active ? days.findIndex((d) => d.date === active.date) : -1;
  const tip = active && activeIndex >= 0 ? geometry(activeIndex, active.count) : null;

  return (
    <div className="dashboard-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        // Never scale above natural size: one SVG unit is one CSS px, so MAX_BAR caps real px.
        style={{ maxWidth: width }}
        role="img"
        aria-label={`Orders per day, ${first} to ${last}`}
      >
        {yTicks(max).map((tick) => {
          const y = baseline - (tick / top) * PLOT_H;
          return (
            <g key={tick}>
              <line className="grid" x1={MARGIN.left} x2={width - MARGIN.right} y1={y} y2={y} />
              <text
                className="axis"
                x={MARGIN.left - 6}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {tick}
              </text>
            </g>
          );
        })}
        {days.map((d, i) => {
          const { x, y, h } = geometry(i, d.count);
          return (
            <rect
              key={d.date}
              className="bar"
              data-date={d.date}
              data-count={d.count}
              x={x}
              y={y}
              width={barW}
              height={h}
              tabIndex={0}
              aria-label={`${d.date}: ${d.count} orders`}
              onMouseEnter={() => setActive(d)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(d)}
              onBlur={() => setActive(null)}
            />
          );
        })}
        {labelIndices(days.length).map((i) => (
          <text
            key={i}
            className="axis"
            x={MARGIN.left + i * slot + slot / 2}
            y={baseline + 16}
            textAnchor={anchorFor(i, days.length)}
          >
            {days[i]!.date}
          </text>
        ))}
      </svg>
      {active && tip && (
        <div
          role="tooltip"
          className="dashboard-tooltip"
          style={{
            left: `${((tip.x + barW / 2) / width) * 100}%`,
            top: `${(tip.y / height) * 100}%`,
          }}
        >
          {`${active.date} · ${active.count} orders`}
        </div>
      )}
    </div>
  );
}

function RevenueByStatus({ revenue }: { revenue: Stats['revenue_by_status'] }) {
  const rows = (['new', 'paid', 'shipped'] as const).map((status) => ({
    status,
    value: revenue[status],
  }));
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <section className="dashboard-revenue">
      <h3>Revenue by status</h3>
      {rows.map(({ status, value }) => (
        <div key={status} className="dashboard-revenue-row">
          <span className="label">{status}</span>
          <span className="track">
            <span className="fill" style={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }} />
          </span>
          <span className="value">{formatCents(value)}</span>
        </div>
      ))}
    </section>
  );
}

function DataTable({ days }: { days: Day[] }) {
  return (
    <details>
      <summary>Show data table</summary>
      <Table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Orders</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </details>
  );
}

declare const __BUILD_VERSION__: string;
export const buildVersion: string = __BUILD_VERSION__;

function DashboardContent() {
  const { stats, failed, reload } = useStats();

  if (failed) {
    return (
      <div role="alert">
        <p>Could not load dashboard</p>
        <Button onClick={reload}>Retry</Button>
      </div>
    );
  }
  if (!stats) return <p role="status">Loading dashboard…</p>;

  const days = fillDays(stats.orders_per_day);
  return (
    <div className="dashboard">
      <Tiles stats={stats} />
      <figure>
        <figcaption>Orders per day</figcaption>
        {days.length === 0 ? <p>No orders yet</p> : <OrdersChart days={days} />}
      </figure>
      <RevenueByStatus revenue={stats.revenue_by_status} />
      {days.length > 0 && <DataTable days={days} />}
    </div>
  );
}

// Deliver cache updates in a microtask, not a macrotask: results render in the same tick as the fetch.
notifyManager.setScheduler(queueMicrotask);

// One QueryClient per mount and per user (a user change remounts it, so no cache is shared).
function DashboardRoot() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <DashboardContent />
    </QueryClientProvider>
  );
}

export default function DashboardPage() {
  const userId = useAuth((s) => s.user?.id);
  return <DashboardRoot key={userId ?? 'anonymous'} />;
}

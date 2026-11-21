import { getStats, type Stats } from '@mfe/api-client';
import { useAuth } from '@mfe/auth-store/react';
import { on } from '@mfe/events';
import { Button, formatDate, formatMoney, formatNumber, Skeleton, Table, useLocale } from '@mfe/ui';
import {
  notifyManager,
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useFlag, useFlagsSync } from './flags.ts';
import { useT } from './messages.ts';
import { fillDays, formatDayMonth, niceMax, totalRevenue, yTicks } from './stats.ts';
import './dashboard.css';
import './telemetry.ts';

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
  const t = useT().tiles;
  const locale = useLocale();
  const tiles = [
    [t.products, formatNumber(stats.counts.products, locale)],
    [t.orders, formatNumber(stats.counts.orders, locale)],
    [t.revenue, formatMoney(totalRevenue(stats.revenue_by_status), locale)],
    [t.paid, formatMoney(stats.revenue_by_status.paid, locale)],
  ];
  return (
    <dl className="ds1-readings dashboard-tiles">
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
  const t = useT();
  const locale = useLocale();
  const [active, setActive] = useState<Day | null>(null);
  const max = Math.max(...days.map((d) => d.count));
  const top = niceMax(max);
  const plotW = Math.max(MIN_PLOT_W, days.length * MIN_SLOT);
  const slot = plotW / days.length;
  const barW = Math.min(MAX_BAR, slot - GAP);
  const width = MARGIN.left + plotW + MARGIN.right;
  const height = MARGIN.top + PLOT_H + MARGIN.bottom;
  const baseline = MARGIN.top + PLOT_H;
  const total = days.reduce((sum, d) => sum + d.count, 0);
  const peak = days.find((d) => d.count === max)!;
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
        aria-label={t.chartLabel(
          formatDate(first, locale),
          formatDate(last, locale),
          formatNumber(total, locale),
          formatNumber(peak.count, locale),
          formatDate(peak.date, locale),
        )}
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
              // Mouse tooltip only: bars are not focusable, the data table is the accessible alternative.
              onMouseEnter={() => setActive(d)}
              onMouseLeave={() => setActive(null)}
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
            {formatDayMonth(days[i]!.date, locale)}
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
          {t.tooltip(formatDate(active.date, locale), formatNumber(active.count, locale))}
        </div>
      )}
    </div>
  );
}

function RevenueByStatus({ revenue }: { revenue: Stats['revenue_by_status'] }) {
  const t = useT();
  const locale = useLocale();
  const rows = (['new', 'paid', 'shipped'] as const).map((status) => ({
    status,
    value: revenue[status],
  }));
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <section className="dashboard-revenue">
      <h3>{t.revenueByStatus}</h3>
      {rows.map(({ status, value }) => (
        <div key={status} className="dashboard-revenue-row">
          <span className="label">{t.status[status]}</span>
          <span className="track">
            <span className="fill" style={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }} />
          </span>
          <span className="value">{formatMoney(value, locale)}</span>
        </div>
      ))}
    </section>
  );
}

function DataTable({ days }: { days: Day[] }) {
  const t = useT();
  const locale = useLocale();
  return (
    <details>
      <summary>{t.showTable}</summary>
      <Table label={t.ordersPerDay}>
        <thead>
          <tr>
            <th scope="col">{t.date}</th>
            <th scope="col">{t.orders}</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <th scope="row">
                <time dateTime={d.date}>{formatDate(d.date, locale)}</time>
              </th>
              <td>{formatNumber(d.count, locale)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </details>
  );
}

// Same blocks, classes and sizes as the loaded view, so the data swaps in without moving anything.
function DashboardSkeleton({ showRevenue }: { showRevenue: boolean }) {
  const t = useT();
  const tiles = [t.tiles.products, t.tiles.orders, t.tiles.revenue, t.tiles.paid];
  return (
    <div className="dashboard" aria-hidden="true">
      <dl className="ds1-readings dashboard-tiles">
        {tiles.map((term, i) => (
          <div key={term} className="dashboard-tile">
            <dt>{term}</dt>
            <dd>
              <Skeleton width={['35%', '40%', '60%', '55%'][i]} height="0.8em" />
            </dd>
          </div>
        ))}
      </dl>
      <figure>
        <figcaption>{t.ordersPerDay}</figcaption>
        <div className="dashboard-chart">
          <Skeleton
            className="dashboard-chart-skeleton"
            width="100%"
            height="auto"
            radius="var(--ds1-radius)"
          />
        </div>
      </figure>
      {showRevenue && (
        <section className="dashboard-revenue">
          <h3>{t.revenueByStatus}</h3>
          {[70, 100, 45].map((w, i) => (
            <div key={i} className="dashboard-revenue-row">
              <span className="label">
                <Skeleton width="60%" />
              </span>
              <span className="track">
                <Skeleton width={`${w}%`} height="100%" radius="0 4px 4px 0" />
              </span>
              <span className="value">
                <Skeleton width="70%" />
              </span>
            </div>
          ))}
        </section>
      )}
      {/* The loaded view ends with this toggle: inert, so it takes no focus while loading. */}
      <details inert>
        <summary>{t.showTable}</summary>
      </details>
    </div>
  );
}

declare const __BUILD_VERSION__: string;
export const buildVersion: string = __BUILD_VERSION__;

function DashboardContent() {
  const t = useT();
  const { stats, failed, reload } = useStats();
  useFlagsSync();
  const showRevenue = useFlag('dashboard.revenue', true);

  if (failed) {
    return (
      <div role="alert">
        <p>{t.loadFailed}</p>
        <Button onClick={reload}>{t.retry}</Button>
      </div>
    );
  }
  if (!stats) {
    return (
      <>
        <p role="status" className="visually-hidden">
          {t.loading}
        </p>
        <DashboardSkeleton showRevenue={showRevenue} />
      </>
    );
  }

  const days = fillDays(stats.orders_per_day);
  return (
    <div className="dashboard">
      <Tiles stats={stats} />
      <figure>
        <figcaption>{t.ordersPerDay}</figcaption>
        {days.length === 0 ? <p>{t.noOrders}</p> : <OrdersChart days={days} />}
      </figure>
      {showRevenue && <RevenueByStatus revenue={stats.revenue_by_status} />}
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

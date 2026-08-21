// The visualisation half of the admin dashboard: everything driven by /api/admin/insights.
//
// Split out of pages/Admin.tsx (already 1600+ lines) so the chart wiring stays readable, and so
// the dashboard's KPI/recent-order half keeps working untouched if this panel fails to load —
// insights are a separate request with their own error state, not part of the dashboard payload.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import type { AdminInsights } from '@/types';
import { AreaChart, BarList, ChartFrame, Donut, Sparkline } from '../charts/Charts';
import { compactInr } from '../charts/geometry';

/** Windows offered in the UI. The server accepts more (180/365) but clamps anything it doesn't. */
const RANGES = [7, 30, 90];
const DEFAULT_RANGE = 30;

function num(value: number | string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dayLabel(iso: string): string {
  // Parsed as a local date deliberately: the server sends calendar days, and `new Date('2026-08-21')`
  // is parsed as UTC midnight, which renders as the *previous* day west of Greenwich.
  const [year, month, day] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(year, month - 1, day));
}

const wholeNumber = (value: number) => Math.round(value).toLocaleString('en-IN');

export function DashboardInsights() {
  const [days, setDays] = useState(DEFAULT_RANGE);
  const [data, setData] = useState<AdminInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    (window: number) => {
      setLoading(true);
      setFailed(false);
      return api.admin
        .insights(window)
        .then(response => {
          setData(response);
          // The server clamps `days` to a window it will serve; follow it rather than keeping a
          // chip highlighted that doesn't describe the data on screen.
          setDays(response.days);
        })
        .catch(() => {
          setData(null);
          setFailed(true);
        })
        .finally(() => setLoading(false));
    },
    [],
  );

  // Initial fetch only — range changes call load() from the click handler, so a server-clamped
  // `days` can't bounce this effect into a second request. Deferred through a resolved promise
  // (the pattern AdminDashboard already uses) so load()'s setLoading(true) doesn't run
  // synchronously inside the effect body and cascade a render.
  useEffect(() => {
    void Promise.resolve().then(() => load(DEFAULT_RANGE));
  }, [load]);

  // Memoized so the `|| []` fallback doesn't mint a fresh array (and re-run every chart's
  // useMemo) on every render.
  const series = useMemo(() => data?.revenue_series || [], [data]);
  const labels = useMemo(() => series.map(row => dayLabel(row.date)), [series]);
  const netValues = useMemo(() => series.map(row => num(row.net)), [series]);
  const refundValues = useMemo(() => series.map(row => num(row.refunds)), [series]);
  const orderValues = useMemo(() => series.map(row => row.orders), [series]);
  const customerValues = useMemo(() => series.map(row => row.customers), [series]);

  const totals = data?.totals;
  const hasRevenue = netValues.some(value => value > 0) || refundValues.some(value => value > 0);
  const hasOrders = orderValues.some(value => value > 0) || customerValues.some(value => value > 0);

  const summary = [
    { label: 'Net revenue', value: compactInr(num(totals?.net)), spark: netValues, color: 'var(--gold)' },
    { label: 'Paid orders', value: wholeNumber(totals?.paid_orders || 0), spark: orderValues, color: 'var(--ruby-2)' },
    { label: 'Avg order value', value: compactInr(num(totals?.avg_order_value)), spark: netValues, color: 'var(--green-2)' },
    { label: 'New customers', value: wholeNumber(totals?.customers || 0), spark: customerValues, color: 'var(--blue)' },
  ];

  return (
    <div className="dash-insights">
      <div className="dash-insights-head">
        <div>
          <span className="admin-eyebrow">Trends</span>
          <h3>Last {days} days</h3>
        </div>
        <div className="admin-head-actions">
          <div className="dash-range" role="group" aria-label="Chart range">
            {RANGES.map(range => (
              <button
                key={range}
                type="button"
                className={range === days ? 'on' : ''}
                aria-pressed={range === days}
                onClick={() => {
                  setDays(range);
                  void load(range);
                }}
              >
                {range}d
              </button>
            ))}
          </div>
          <button className="admin-soft-btn" onClick={() => void load(days)} disabled={loading}>
            <RefreshCw size={14} /> {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {failed && (
        <div className="admin-alert">
          Trend data could not be loaded. The KPIs and recent orders above are unaffected.
        </div>
      )}

      <div className="dash-summary">
        {summary.map(item => (
          <article key={item.label} className={`dash-summary-card ${loading ? 'is-loading' : ''}`}>
            <span>{item.label}</span>
            <strong>{data ? item.value : '—'}</strong>
            {data && <Sparkline values={item.spark} color={item.color} />}
          </article>
        ))}
      </div>

      <ChartFrame
        title="Revenue"
        subtitle={`net vs refunds · ${days} days`}
        empty={!loading && !hasRevenue}
        emptyLabel="No captured payments in this window."
      >
        <AreaChart
          labels={labels}
          series={[
            { label: 'Net revenue', values: netValues, color: 'var(--gold)' },
            { label: 'Refunds', values: refundValues, color: 'var(--ruby-2)' },
          ]}
        />
      </ChartFrame>

      <ChartFrame
        title="Orders & new customers"
        subtitle={`per day · ${days} days`}
        empty={!loading && !hasOrders}
        emptyLabel="No orders placed in this window."
      >
        <AreaChart
          labels={labels}
          format={wholeNumber}
          height={190}
          series={[
            { label: 'Orders', values: orderValues, color: 'var(--blue)' },
            { label: 'New customers', values: customerValues, color: 'var(--green-2)' },
          ]}
        />
      </ChartFrame>

      <div className="chart-row-2">
        <ChartFrame title="Top products" subtitle="by revenue" empty={!loading && !(data?.top_products || []).length}>
          <BarList
            rows={(data?.top_products || []).map(row => ({
              label: row.name,
              value: num(row.revenue),
              note: `${wholeNumber(row.units)} unit${row.units === 1 ? '' : 's'}`,
            }))}
          />
        </ChartFrame>

        <ChartFrame title="Category mix" subtitle="share of revenue" empty={!loading && !(data?.category_mix || []).length}>
          <Donut
            slices={(data?.category_mix || []).map(row => ({ label: row.category, value: num(row.revenue) }))}
            centerLabel="net revenue"
            centerValue={compactInr(num(totals?.net))}
          />
        </ChartFrame>
      </div>

      <div className="chart-row-2">
        <ChartFrame title="Payment methods" subtitle="captured amount" empty={!loading && !(data?.payment_mix || []).length}>
          <Donut
            slices={(data?.payment_mix || []).map(row => ({ label: row.label, value: num(row.amount) }))}
            centerLabel="paid orders"
            centerValue={wholeNumber(totals?.paid_orders || 0)}
          />
        </ChartFrame>

        <ChartFrame title="Orders by status" subtitle="current pipeline" empty={!loading && !(data?.orders_by_status || []).length}>
          <BarList
            rows={(data?.orders_by_status || []).map(row => ({ label: row.label, value: row.count }))}
            format={wholeNumber}
          />
        </ChartFrame>
      </div>
    </div>
  );
}

// Hand-rolled SVG charts for the admin dashboard.
//
// Deliberately not a charting library: the four shapes below are all this console needs, and a
// recharts/chart.js dependency would add ~100KB gzipped to a bundle that is already ~143KB for
// a storefront most customers reach on mobile. Everything renders as plain SVG that inherits
// the admin CSS tokens, so dark mode and theming come for free.
//
// The maths lives in ./geometry (pure and unit-tested); these components only turn its output
// into elements and hover state.

import { useId, useState } from 'react';
import {
  DEFAULT_BOX,
  areaPath,
  axisMax,
  compactInr,
  donutSegments,
  labelStride,
  linePath,
  plotHeight,
  plotWidth,
  seriesColor,
  seriesPoints,
} from './geometry';

interface ChartFrameProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  /** Rendered instead of the chart when there is nothing to plot. */
  empty?: boolean;
  emptyLabel?: string;
  children: React.ReactNode;
}

export function ChartFrame({ title, subtitle, action, empty, emptyLabel, children }: ChartFrameProps) {
  return (
    <section className="chart-card">
      <div className="chart-title chart-title-between">
        <span>
          {title}
          {subtitle && <em className="chart-subtitle">{subtitle}</em>}
        </span>
        {action}
      </div>
      {empty ? <p className="chart-empty">{emptyLabel || 'No data in this window yet.'}</p> : children}
    </section>
  );
}

export interface AreaSeries {
  label: string;
  values: number[];
  color?: string;
}

interface AreaChartProps {
  series: AreaSeries[];
  labels: string[];
  /** Formats both the y-axis ticks and the hover readout. */
  format?: (value: number) => string;
  height?: number;
}

/**
 * Multi-series area/line chart with a shared hover column. The hover state is an index into the
 * series rather than a pixel position, so the readout always names a real data point instead of
 * interpolating between two.
 */
export function AreaChart({ series, labels, format = compactInr, height }: AreaChartProps) {
  const box = height ? { ...DEFAULT_BOX, height } : DEFAULT_BOX;
  const [hover, setHover] = useState<number | null>(null);
  const gradientId = useId();

  const max = axisMax(series.flatMap(entry => entry.values));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(fraction => fraction * max);
  const count = labels.length;
  const stride = labelStride(count);
  const w = plotWidth(box);
  const h = plotHeight(box);
  const plotted = series.map(entry => seriesPoints(entry.values, max, box));

  return (
    <div className="chart-plot">
      <svg
        viewBox={`0 0 ${box.width} ${box.height}`}
        role="img"
        aria-label={`${series.map(entry => entry.label).join(' and ')} over ${count} days`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          {series.map((entry, index) => (
            <linearGradient key={entry.label} id={`${gradientId}-${index}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={entry.color || seriesColor(index)} stopOpacity="0.28" />
              <stop offset="100%" stopColor={entry.color || seriesColor(index)} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {ticks.map(tick => {
          const y = box.padTop + h - (max > 0 ? tick / max : 0) * h;
          return (
            <g key={tick}>
              <line className="chart-grid" x1={box.padLeft} x2={box.padLeft + w} y1={y} y2={y} />
              <text className="chart-axis" x={box.padLeft - 8} y={y + 3} textAnchor="end">
                {format(tick)}
              </text>
            </g>
          );
        })}

        {series.map((entry, index) => {
          const points = plotted[index];
          const color = entry.color || seriesColor(index);
          return (
            <g key={entry.label}>
              <path d={areaPath(points, box)} fill={`url(#${gradientId}-${index})`} />
              <path className="chart-line" d={linePath(points)} stroke={color} />
              {/* A one-day window has no line to draw, so mark the point itself. */}
              {points.length === 1 && <circle cx={points[0].x} cy={points[0].y} r="3.5" fill={color} />}
            </g>
          );
        })}

        {hover !== null && plotted[0]?.[hover] && (
          <g>
            <line
              className="chart-hover-line"
              x1={plotted[0][hover].x}
              x2={plotted[0][hover].x}
              y1={box.padTop}
              y2={box.padTop + h}
            />
            {series.map((entry, index) => {
              const point = plotted[index][hover];
              return point ? (
                <circle key={entry.label} cx={point.x} cy={point.y} r="4" fill={entry.color || seriesColor(index)} />
              ) : null;
            })}
          </g>
        )}

        {labels.map((label, index) =>
          index % stride === 0 || index === count - 1 ? (
            <text
              key={label}
              className="chart-axis"
              x={box.padLeft + (count === 1 ? 0 : (index / Math.max(1, count - 1)) * w)}
              y={box.height - 8}
              textAnchor={index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle'}
            >
              {label}
            </text>
          ) : null,
        )}

        {/* Invisible full-height columns give every point a generous hover target — hovering a
            2px line directly is unusable, especially on a 90-day window. */}
        {labels.map((label, index) => (
          <rect
            key={`hit-${label}`}
            x={box.padLeft + (index - 0.5) * (w / Math.max(1, count - 1 || 1))}
            y={box.padTop}
            width={w / Math.max(1, count - 1 || 1)}
            height={h}
            fill="transparent"
            onMouseEnter={() => setHover(index)}
          />
        ))}
      </svg>

      <div className="chart-legend">
        {series.map((entry, index) => (
          <span key={entry.label}>
            <i style={{ background: entry.color || seriesColor(index) }} />
            {entry.label}
            {hover !== null && <strong>{format(entry.values[hover] ?? 0)}</strong>}
          </span>
        ))}
        <span className="chart-legend-when">{hover !== null ? labels[hover] : `Last ${count} days`}</span>
      </div>
    </div>
  );
}

export interface BarRow {
  label: string;
  value: number;
  /** Optional second line under the label (e.g. "12 units"). */
  note?: string;
}

interface BarListProps {
  rows: BarRow[];
  format?: (value: number) => string;
  color?: string;
}

/**
 * Horizontal bar list. Preferred over vertical bars for top-N breakdowns because product and
 * category names are long — a vertical axis would need them rotated to fit.
 */
export function BarList({ rows, format = compactInr, color }: BarListProps) {
  const max = Math.max(1, ...rows.map(row => row.value));
  return (
    <ul className="chart-bars">
      {rows.map((row, index) => (
        <li key={row.label}>
          <div className="chart-bar-head">
            <span className="chart-bar-label" title={row.label}>
              {row.label}
            </span>
            <strong>{format(row.value)}</strong>
          </div>
          <div className="chart-bar-track">
            <div
              className="chart-bar-fill"
              style={{ width: `${(row.value / max) * 100}%`, background: color || seriesColor(index) }}
            />
          </div>
          {row.note && <em className="chart-bar-note">{row.note}</em>}
        </li>
      ))}
    </ul>
  );
}

export interface DonutSlice {
  label: string;
  value: number;
}

interface DonutProps {
  slices: DonutSlice[];
  format?: (value: number) => string;
  centerLabel?: string;
  centerValue?: string;
}

const DONUT_RADIUS = 54;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

export function Donut({ slices, format = compactInr, centerLabel, centerValue }: DonutProps) {
  const segments = donutSegments(
    slices.map(slice => slice.value),
    DONUT_CIRCUMFERENCE,
  );
  return (
    <div className="chart-donut">
      <svg viewBox="0 0 140 140" role="img" aria-label={slices.map(slice => `${slice.label}: ${format(slice.value)}`).join(', ')}>
        <circle className="chart-donut-track" cx="70" cy="70" r={DONUT_RADIUS} />
        {segments.map((segment, index) => (
          <circle
            key={slices[index].label}
            className="chart-donut-seg"
            cx="70"
            cy="70"
            r={DONUT_RADIUS}
            stroke={seriesColor(index)}
            strokeDasharray={segment.dashArray}
            strokeDashoffset={segment.dashOffset}
          />
        ))}
        {centerValue && (
          <>
            <text className="chart-donut-value" x="70" y="68" textAnchor="middle">
              {centerValue}
            </text>
            <text className="chart-donut-label" x="70" y="84" textAnchor="middle">
              {centerLabel}
            </text>
          </>
        )}
      </svg>
      <ul className="chart-donut-legend">
        {slices.map((slice, index) => (
          <li key={slice.label}>
            <i style={{ background: seriesColor(index) }} />
            <span>{slice.label}</span>
            <strong>{format(slice.value)}</strong>
            <em>{Math.round(segments[index].share * 100)}%</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Tiny inline trend line for KPI cards — no axes, no hover, just the shape of the series. */
export function Sparkline({ values, color }: { values: number[]; color?: string }) {
  const box = { width: 120, height: 34, padTop: 4, padRight: 2, padBottom: 4, padLeft: 2 };
  const points = seriesPoints(values, axisMax(values), box);
  if (points.length < 2) return null;
  return (
    <svg className="kpi-spark" viewBox={`0 0 ${box.width} ${box.height}`} aria-hidden="true">
      <path d={areaPath(points, box)} fill={color || 'var(--gold)'} opacity="0.16" />
      <path className="chart-line" d={linePath(points)} stroke={color || 'var(--gold)'} />
    </svg>
  );
}

// Pure geometry + scaling for the hand-rolled admin charts. Kept free of React and of the DOM
// so the maths that decides where a point lands is unit-testable on its own — the SVG
// components in Charts.tsx are thin renderers over what this module returns.
//
// Everything works in a fixed viewBox coordinate space (see ChartBox); the SVG scales itself to
// whatever width the card gives it, so nothing here needs a measured pixel size.

export interface ChartBox {
  width: number;
  height: number;
  padTop: number;
  padRight: number;
  padBottom: number;
  padLeft: number;
}

export const DEFAULT_BOX: ChartBox = {
  width: 640,
  height: 220,
  padTop: 12,
  padRight: 12,
  padBottom: 26,
  padLeft: 52,
};

export interface Point {
  x: number;
  y: number;
}

export function plotWidth(box: ChartBox): number {
  return box.width - box.padLeft - box.padRight;
}

export function plotHeight(box: ChartBox): number {
  return box.height - box.padTop - box.padBottom;
}

/**
 * Round a raw maximum up to a "nice" axis top (1/2/5 x a power of ten) and split it into
 * `count` even gridlines. An axis topped at the literal data maximum puts the peak exactly on
 * the frame and produces labels like "₹18,437", which nobody can read at a glance.
 */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) {
    // A flat all-zero series still needs an axis, or the chart renders with no scale at all.
    return Array.from({ length: count + 1 }, (_, index) => index);
  }
  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  return Array.from({ length: count + 1 }, (_, index) => step * index);
}

/** Top of the axis for `values` — the last of its nice ticks. */
export function axisMax(values: number[], count = 4): number {
  const ticks = niceTicks(Math.max(0, ...values), count);
  return ticks[ticks.length - 1] || 1;
}

/**
 * Map a series to viewBox points. A single-point series is pinned to the left edge rather than
 * dividing by zero — one day of data is a dot, not a line across the card.
 */
export function seriesPoints(values: number[], max: number, box: ChartBox = DEFAULT_BOX): Point[] {
  const w = plotWidth(box);
  const h = plotHeight(box);
  const span = Math.max(1, values.length - 1);
  const top = max > 0 ? max : 1;
  return values.map((value, index) => ({
    x: box.padLeft + (values.length === 1 ? 0 : (index / span) * w),
    y: box.padTop + h - (Math.max(0, value) / top) * h,
  }));
}

/** Polyline `d` for a set of points. Empty string for an empty series (an SVG path of "" draws nothing). */
export function linePath(points: Point[]): string {
  if (points.length === 0) return '';
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${round(point.x)} ${round(point.y)}`).join(' ');
}

/** Same line, closed down to the baseline, for the filled area under an area chart. */
export function areaPath(points: Point[], box: ChartBox = DEFAULT_BOX): string {
  if (points.length === 0) return '';
  const baseline = box.padTop + plotHeight(box);
  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath(points)} L${round(last.x)} ${round(baseline)} L${round(first.x)} ${round(baseline)} Z`;
}

export interface DonutSegment {
  value: number;
  /** Share of the whole, 0–1. */
  share: number;
  /** `stroke-dasharray` and `stroke-dashoffset` for a circle of circumference `circumference`. */
  dashArray: string;
  dashOffset: number;
}

/**
 * Lay segments out around a stroked circle. Uses dash offsets rather than arc paths because a
 * stroked circle stays crisp at any radius and needs no trigonometry to close cleanly.
 * A zero total yields zero-length segments instead of NaN dash values.
 */
export function donutSegments(values: number[], circumference: number): DonutSegment[] {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  let consumed = 0;
  return values.map(raw => {
    const value = Math.max(0, raw);
    const share = total > 0 ? value / total : 0;
    const length = share * circumference;
    const segment: DonutSegment = {
      value,
      share,
      dashArray: `${round(length)} ${round(circumference - length)}`,
      dashOffset: -round(consumed),
    };
    consumed += length;
    return segment;
  });
}

/**
 * Thin a long series down to at most `max` labels, keeping the first and last. A 365-day
 * x-axis cannot show 365 dates; dropping every label but a handful is the readable option.
 */
export function labelStride(length: number, max = 7): number {
  if (length <= max) return 1;
  return Math.ceil(length / max);
}

/** ₹ in Indian short scale — the axis has no room for "₹12,50,000". */
export function compactInr(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 10_000_000) return `₹${trim(value / 10_000_000)}Cr`;
  if (abs >= 100_000) return `₹${trim(value / 100_000)}L`;
  if (abs >= 1_000) return `₹${trim(value / 1_000)}K`;
  return `₹${Math.round(value)}`;
}

function trim(value: number): string {
  // One decimal, but no trailing ".0" — "₹2L" reads better than "₹2.0L".
  return value.toFixed(1).replace(/\.0$/, '');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}


/**
 * Palette the charts cycle through, mirroring the KPI card tones in admin.css. Lives here
 * rather than beside the components so Charts.tsx exports only components (react-refresh).
 */
export const SERIES_COLORS = [
  'var(--gold)',
  'var(--ruby-2)',
  'var(--green-2)',
  'var(--blue)',
  'var(--gold-2)',
  'var(--indigo)',
  'var(--warning)',
  'var(--soft)',
];

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

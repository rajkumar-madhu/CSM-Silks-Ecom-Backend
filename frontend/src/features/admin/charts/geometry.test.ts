import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOX,
  areaPath,
  axisMax,
  compactInr,
  donutSegments,
  labelStride,
  linePath,
  niceTicks,
  plotHeight,
  seriesPoints,
} from './geometry';

describe('niceTicks', () => {
  it('rounds the axis top up to a 1/2/5 step rather than the raw maximum', () => {
    expect(niceTicks(18437, 4)).toEqual([0, 5000, 10000, 15000, 20000]);
    expect(niceTicks(9, 4)).toEqual([0, 5, 10, 15, 20]);
  });

  it('still produces an axis for an all-zero series', () => {
    expect(niceTicks(0, 4)).toEqual([0, 1, 2, 3, 4]);
    expect(niceTicks(Number.NaN, 2)).toEqual([0, 1, 2]);
  });

  it('always covers the data', () => {
    for (const max of [1, 7, 42, 999, 1234, 87654]) {
      expect(axisMax([max])).toBeGreaterThanOrEqual(max);
    }
  });
});

describe('seriesPoints', () => {
  it('spreads points across the plot area and inverts y', () => {
    const points = seriesPoints([0, 50, 100], 100);
    expect(points[0].x).toBe(DEFAULT_BOX.padLeft);
    expect(points[2].x).toBe(DEFAULT_BOX.width - DEFAULT_BOX.padRight);
    // Highest value sits at the top of the plot, zero on the baseline.
    expect(points[2].y).toBe(DEFAULT_BOX.padTop);
    expect(points[0].y).toBe(DEFAULT_BOX.padTop + plotHeight(DEFAULT_BOX));
    expect(points[1].y).toBeCloseTo(DEFAULT_BOX.padTop + plotHeight(DEFAULT_BOX) / 2);
  });

  it('pins a single-point series to the left edge instead of dividing by zero', () => {
    const [only] = seriesPoints([12], 100);
    expect(only.x).toBe(DEFAULT_BOX.padLeft);
    expect(Number.isFinite(only.y)).toBe(true);
  });

  it('treats a zero maximum as one so a flat series sits on the baseline', () => {
    const points = seriesPoints([0, 0, 0], 0);
    expect(points.every(point => point.y === DEFAULT_BOX.padTop + plotHeight(DEFAULT_BOX))).toBe(true);
  });
});

describe('paths', () => {
  it('emits a move followed by lines', () => {
    expect(linePath(seriesPoints([1, 2], 2))).toMatch(/^M\d/);
    expect(linePath(seriesPoints([1, 2], 2)).split('L')).toHaveLength(2);
  });

  it('closes the area down to the baseline', () => {
    const path = areaPath(seriesPoints([1, 2], 2));
    expect(path.endsWith('Z')).toBe(true);
    expect(path).toContain(`${DEFAULT_BOX.padTop + plotHeight(DEFAULT_BOX)}`);
  });

  it('draws nothing for an empty series', () => {
    expect(linePath([])).toBe('');
    expect(areaPath([])).toBe('');
  });
});

describe('donutSegments', () => {
  it('splits the circumference in proportion and chains the offsets', () => {
    const [first, second] = donutSegments([75, 25], 100);
    expect(first.share).toBeCloseTo(0.75);
    expect(first.dashArray).toBe('75 25');
    expect(first.dashOffset).toBe(-0);
    expect(second.dashArray).toBe('25 75');
    expect(second.dashOffset).toBe(-75);
  });

  it('produces zero-length segments (not NaN) when everything is zero', () => {
    const segments = donutSegments([0, 0], 100);
    expect(segments.every(segment => segment.share === 0)).toBe(true);
    expect(segments[0].dashArray).toBe('0 100');
  });

  it('ignores negative values rather than reversing a segment', () => {
    const [a, b] = donutSegments([-10, 10], 100);
    expect(a.value).toBe(0);
    expect(b.share).toBe(1);
  });
});

describe('labelStride', () => {
  it('shows every label when the series is short', () => {
    expect(labelStride(5, 7)).toBe(1);
  });

  it('thins a long series', () => {
    expect(labelStride(30, 7)).toBe(5);
    expect(labelStride(365, 7)).toBe(53);
  });
});

describe('compactInr', () => {
  it('uses the Indian short scale', () => {
    expect(compactInr(950)).toBe('₹950');
    expect(compactInr(12_500)).toBe('₹12.5K');
    expect(compactInr(250_000)).toBe('₹2.5L');
    expect(compactInr(20_000_000)).toBe('₹2Cr');
  });

  it('drops a trailing .0', () => {
    expect(compactInr(2_000)).toBe('₹2K');
  });
});

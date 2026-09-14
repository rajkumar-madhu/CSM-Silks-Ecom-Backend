import type { Product, ProductVariant } from '@/types';

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'FREE SIZE', '36', '38', '40', '42'];

export function normalizeSize(size?: string) {
  if (!size) return '';
  const trimmed = size.trim();
  if (trimmed.toLowerCase() === 'free size') return 'Free Size';
  if (/^\d+$/.test(trimmed)) return trimmed;
  return trimmed.split('-')[0]?.trim().toUpperCase() || trimmed.toUpperCase();
}

function sizeSortKey(size: string) {
  const key = normalizeSize(size);
  const idx = SIZE_ORDER.indexOf(key.toUpperCase());
  return idx === -1 ? SIZE_ORDER.length : idx;
}

export function getProductSizes(product: Product) {
  const sizes = [...new Set(
    (product.variants || [])
      .filter(v => v.is_active !== false)
      .map(v => v.size?.trim())
      .filter((size): size is string => Boolean(size)),
  )];
  return sizes.sort((a, b) => sizeSortKey(a) - sizeSortKey(b) || a.localeCompare(b));
}

export function getVariantStockForSize(product: Product, size: string, colorIndex?: number) {
  const normalized = normalizeSize(size);
  const variants = (product.variants || []).filter(v => v.is_active !== false);
  const matches = variants.filter(v => normalizeSize(v.size) === normalized);
  if (!matches.length) return 0;
  if (colorIndex !== undefined && matches[colorIndex]) {
    return Number(matches[colorIndex].available_qty ?? 0);
  }
  return matches.reduce((sum, v) => sum + Number(v.available_qty ?? 0), 0);
}

/** Normalised key for a recorded variant length. 6.30 and 6.3 are the same
 *  length, so they must collapse to one option rather than two chips. */
export function lengthKey(value?: number | string | null) {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '';
  return String(Number(num.toFixed(2)));
}

/** Distinct lengths this product actually records, shortest first. Products with
 *  a single length return one entry — the caller renders a label, not a chooser. */
export function getProductLengths(product: Product) {
  const keys = new Set<string>();
  for (const variant of product.variants || []) {
    if (variant.is_active === false) continue;
    const key = lengthKey(variant.length_meters);
    if (key) keys.add(key);
  }
  return [...keys].sort((a, b) => Number(a) - Number(b));
}

function resolveBase(
  variants: ProductVariant[],
  options?: { size?: string; colorIndex?: number },
): ProductVariant | undefined {

  const size = options?.size ? normalizeSize(options.size) : '';

  if (size) {
    const bySize = variants.find(v => normalizeSize(v.size) === size);
    if (bySize) return bySize;
  }

  if (options?.colorIndex !== undefined) {
    const anchor = variants[options.colorIndex];
    const colorVariants = variants.filter(
      v => v.color_hex === anchor?.color_hex || v.color_name === anchor?.color_name,
    );
    if (size && colorVariants.length) {
      const sized = colorVariants.find(v => normalizeSize(v.size) === size);
      if (sized) return sized;
    }
    if (variants[options.colorIndex]) return variants[options.colorIndex];
  }

  return variants.find(v => Number(v.available_qty ?? 0) > 0) || variants[0];
}

export function resolveProductVariant(
  product: Product,
  options?: { size?: string; colorIndex?: number; length?: string },
): ProductVariant | undefined {
  const variants = (product.variants || []).filter(v => v.is_active !== false);
  if (!variants.length) return undefined;

  const base = resolveBase(variants, options);
  const wanted = lengthKey(options?.length);
  // Length refines the colour/size match rather than replacing it: colorIndex
  // indexes the unfiltered list, so narrowing before resolveBase would silently
  // point that index at a different colour.
  if (!wanted || !base) return base;

  const sameLength = variants.filter(v => lengthKey(v.length_meters) === wanted);
  if (!sameLength.length) return base;

  const sameColourAndSize = sameLength.find(
    v => (v.color_name || '') === (base.color_name || '')
      && (v.color_hex || '') === (base.color_hex || '')
      && normalizeSize(v.size) === normalizeSize(base.size),
  );
  return sameColourAndSize
    || sameLength.find(v => normalizeSize(v.size) === normalizeSize(base.size))
    || sameLength.find(v => Number(v.available_qty ?? 0) > 0)
    || sameLength[0];
}

export function resolveVariantId(
  product: Product,
  options?: { size?: string; colorIndex?: number; length?: string },
) {
  const variant = resolveProductVariant(product, options);
  return variant?.id ?? product.variant_id ?? product.default_variant_id ?? product.variants?.[0]?.id;
}

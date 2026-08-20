// Pure filter-state logic for the Nykaa-style PLP (CatalogPlp). The URL query string is the
// single source of truth: parse/serialize must round-trip so links are shareable and
// back/forward navigation restores the exact view.

// Must match ATTRIBUTE_PARAMS in backend/catalog/selectors.py.
export const ATTRIBUTE_KEYS = ['fabric', 'weave', 'zari', 'border', 'pallu', 'work', 'origin'] as const;
export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];

export interface PlpFilterState {
  category: string;
  sort: string;
  rating: string;
  minPrice: string;
  maxPrice: string;
  discountMin: string;
  colors: string[];
  attributes: Record<string, string[]>;
  occasions: string[];
  inStock: boolean;
}

export const DEFAULT_PLP_STATE: PlpFilterState = {
  category: '',
  sort: 'popularity',
  rating: '',
  minPrice: '',
  maxPrice: '',
  discountMin: '',
  colors: [],
  attributes: {},
  occasions: [],
  inStock: true,
};

const SORT_KEYS = new Set(['popularity', 'price_asc', 'price_desc', 'discount', 'rating', 'newest']);

function cleanNumber(value: string | null): string {
  if (!value) return '';
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : '';
}

function cleanList(value: string | null): string[] {
  if (!value) return [];
  return [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))];
}

export function parsePlpParams(params: URLSearchParams): PlpFilterState {
  const sort = params.get('sort') || '';
  const attributes: Record<string, string[]> = {};
  for (const key of ATTRIBUTE_KEYS) {
    // ?fabrics= is the pre-vocabulary param name; accept it, re-serialize as ?fabric=.
    const raw = params.get(key) ?? (key === 'fabric' ? params.get('fabrics') : null);
    const values = cleanList(raw);
    if (values.length) attributes[key] = values;
  }
  return {
    category: (params.get('category') || '').trim().toLowerCase(),
    sort: SORT_KEYS.has(sort) ? sort : DEFAULT_PLP_STATE.sort,
    rating: cleanNumber(params.get('rating')),
    minPrice: cleanNumber(params.get('min_price')),
    maxPrice: cleanNumber(params.get('max_price')),
    discountMin: cleanNumber(params.get('discount')),
    colors: cleanList(params.get('colors')),
    attributes,
    occasions: cleanList(params.get('occasions')),
    inStock: params.get('instock') !== '0',
  };
}

export function plpStateToParams(state: PlpFilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.category) params.set('category', state.category);
  if (state.sort !== DEFAULT_PLP_STATE.sort) params.set('sort', state.sort);
  if (state.rating) params.set('rating', state.rating);
  if (state.minPrice) params.set('min_price', state.minPrice);
  if (state.maxPrice) params.set('max_price', state.maxPrice);
  if (state.discountMin) params.set('discount', state.discountMin);
  if (state.colors.length) params.set('colors', state.colors.join(','));
  for (const key of ATTRIBUTE_KEYS) {
    const values = state.attributes[key] || [];
    if (values.length) params.set(key, values.join(','));
  }
  if (state.occasions.length) params.set('occasions', state.occasions.join(','));
  if (!state.inStock) params.set('instock', '0');
  return params;
}

export function buildProductQuery(
  state: PlpFilterState,
  extra: { gender: 'women' | 'men'; page: number; perPage: number },
): Record<string, string | number | boolean | undefined> {
  return {
    gender: extra.gender,
    category: state.category || undefined,
    sort: state.sort,
    rating: state.rating || undefined,
    min_price: state.minPrice || undefined,
    max_price: state.maxPrice || undefined,
    discount_min: state.discountMin || undefined,
    color: state.colors.length ? state.colors.join(',') : undefined,
    ...Object.fromEntries(
      ATTRIBUTE_KEYS.map(key => [key, (state.attributes[key] || []).join(',') || undefined]),
    ),
    occasion: state.occasions.length ? state.occasions.join(',') : undefined,
    availability: state.inStock ? 'in_stock' : undefined,
    page: extra.page,
    per_page: extra.perPage,
  };
}

export function toggleListValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter(item => item !== value) : [...list, value];
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatInr(value: string): string {
  return `₹${Number(value).toLocaleString('en-IN')}`;
}

export interface PlpChip {
  key: string;
  label: string;
  next: PlpFilterState;
  // Present only for attribute chips. plpFilters.ts is a pure module with no access to facet
  // labels, so `label` above is the raw slug; a render layer that has the facets can use this
  // to look up the human-readable option label instead of showing the slug.
  attr?: { group: string; slug: string };
}

export function activePlpChips(state: PlpFilterState): PlpChip[] {
  const chips: PlpChip[] = [];
  if (state.category) {
    chips.push({ key: `category:${state.category}`, label: titleCase(state.category), next: { ...state, category: '' } });
  }
  if (state.minPrice || state.maxPrice) {
    const label = state.minPrice && state.maxPrice
      ? `${formatInr(state.minPrice)} - ${formatInr(state.maxPrice)}`
      : state.maxPrice
        ? `Under ${formatInr(state.maxPrice)}`
        : `Above ${formatInr(state.minPrice)}`;
    chips.push({ key: 'price', label, next: { ...state, minPrice: '', maxPrice: '' } });
  }
  if (state.discountMin) {
    chips.push({ key: 'discount', label: `${state.discountMin}% off & more`, next: { ...state, discountMin: '' } });
  }
  if (state.rating) {
    chips.push({ key: 'rating', label: `${state.rating}★ & above`, next: { ...state, rating: '' } });
  }
  for (const color of state.colors) {
    chips.push({ key: `color:${color}`, label: color, next: { ...state, colors: state.colors.filter(item => item !== color) } });
  }
  for (const group of ATTRIBUTE_KEYS) {
    const values = state.attributes[group] || [];
    for (const value of values) {
      chips.push({
        key: `attr:${group}:${value}`,
        label: value,
        next: { ...state, attributes: { ...state.attributes, [group]: values.filter(item => item !== value) } },
        attr: { group, slug: value },
      });
    }
  }
  for (const occasion of state.occasions) {
    chips.push({ key: `occasion:${occasion}`, label: occasion, next: { ...state, occasions: state.occasions.filter(item => item !== occasion) } });
  }
  if (!state.inStock) {
    chips.push({ key: 'instock', label: 'Include out of stock', next: { ...state, inStock: true } });
  }
  return chips;
}

export function clearedPlpState(state: PlpFilterState): PlpFilterState {
  // Sort survives "clear all" (matches Nykaa) — it orders results, it does not narrow them.
  return { ...DEFAULT_PLP_STATE, sort: state.sort, attributes: {} };
}

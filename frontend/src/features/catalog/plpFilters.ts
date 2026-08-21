// Pure filter-state logic for the Nykaa-style PLP (CatalogPlp). The URL query string is the
// single source of truth: parse/serialize must round-trip so links are shareable and
// back/forward navigation restores the exact view.

// Must match ATTRIBUTE_PARAMS in backend/catalog/selectors.py. This is the *default* set of
// URL params `parsePlpParams` treats as attribute groups — a positive allowlist, not a blocklist
// of "everything else". A caller with live facets (see CatalogPlp.tsx) passes ATTRIBUTE_KEYS
// unioned with `facets.attributes[].key` so a backend-added group round-trips the moment the
// server declares it, without ever treating arbitrary URL noise (utm_source, gclid, page, ...) as
// a filter — that was tried as a blocklist and regressed (see plpFilters.test.ts).
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

// Sort options used when /api/products/facets is unreachable (or hasn't answered yet). Lives here
// rather than beside PlpSortBar so the component file only exports components (react-refresh), and
// so the accepted-sort allowlist below can't drift from the options actually offered.
export const FALLBACK_SORTS = [
  { key: 'popularity', label: 'Popularity' },
  { key: 'price_asc', label: 'Price: Low to High' },
  { key: 'price_desc', label: 'Price: High to Low' },
  { key: 'discount', label: 'Biggest Discount' },
  { key: 'rating', label: 'Customer Rating' },
  { key: 'newest', label: 'Newest First' },
];

const SORT_KEYS = new Set(FALLBACK_SORTS.map(sort => sort.key));

function cleanNumber(value: string | null): string {
  if (!value) return '';
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : '';
}

function cleanList(value: string | null): string[] {
  if (!value) return [];
  return [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))];
}

export function parsePlpParams(
  params: URLSearchParams,
  knownAttributeKeys: Iterable<string> = ATTRIBUTE_KEYS,
): PlpFilterState {
  const sort = params.get('sort') || '';
  const attributes: Record<string, string[]> = {};
  for (const key of new Set(knownAttributeKeys)) {
    const values = cleanList(params.get(key));
    if (values.length) attributes[key] = values;
  }
  // ?fabrics= is the pre-vocabulary param name; accept it, re-serialize as ?fabric=.
  if (!attributes.fabric) {
    const legacyFabric = cleanList(params.get('fabrics'));
    if (legacyFabric.length) attributes.fabric = legacyFabric;
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
  for (const [key, values] of Object.entries(state.attributes)) {
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
      Object.entries(state.attributes)
        .filter(([, values]) => values.length)
        .map(([key, values]) => [key, values.join(',')]),
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
  for (const group of Object.keys(state.attributes)) {
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

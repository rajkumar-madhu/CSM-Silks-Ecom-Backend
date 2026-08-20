import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLP_STATE,
  activePlpChips,
  buildProductQuery,
  clearedPlpState,
  parsePlpParams,
  plpStateToParams,
  toggleListValue,
} from './plpFilters';

describe('parsePlpParams', () => {
  it('returns defaults for an empty query string', () => {
    expect(parsePlpParams(new URLSearchParams())).toEqual(DEFAULT_PLP_STATE);
  });

  it('parses every supported param', () => {
    const params = new URLSearchParams(
      'category=Bridal&sort=price_asc&rating=4&min_price=2000&max_price=5000&discount=25&colors=Red,Green&fabrics=Pure silk&occasions=Wedding&instock=0',
    );
    expect(parsePlpParams(params)).toEqual({
      category: 'bridal',
      sort: 'price_asc',
      rating: '4',
      minPrice: '2000',
      maxPrice: '5000',
      discountMin: '25',
      colors: ['Red', 'Green'],
      fabrics: ['Pure silk'],
      occasions: ['Wedding'],
      inStock: false,
    });
  });

  it('ignores garbage values', () => {
    const params = new URLSearchParams('sort=hack&rating=abc&max_price=-5&colors=,,');
    expect(parsePlpParams(params)).toEqual(DEFAULT_PLP_STATE);
  });
});

describe('plpStateToParams', () => {
  it('omits defaults so clean pages have clean URLs', () => {
    expect(plpStateToParams(DEFAULT_PLP_STATE).toString()).toBe('');
  });

  it('round-trips through parse', () => {
    const state = {
      ...DEFAULT_PLP_STATE,
      category: 'kanjivaram',
      sort: 'discount',
      colors: ['Red', 'Blue'],
      maxPrice: '10000',
      inStock: false,
    };
    expect(parsePlpParams(plpStateToParams(state))).toEqual(state);
  });
});

describe('buildProductQuery', () => {
  it('maps state onto the API contract', () => {
    const query = buildProductQuery(
      { ...DEFAULT_PLP_STATE, colors: ['Red', 'Green'], fabrics: ['Silk'], maxPrice: '9000' },
      { gender: 'women', page: 2, perPage: 24 },
    );
    expect(query).toMatchObject({
      gender: 'women',
      color: 'Red,Green',
      fabric: 'Silk',
      max_price: '9000',
      availability: 'in_stock',
      page: 2,
      per_page: 24,
    });
    expect(query.category).toBeUndefined();
    expect(query.occasion).toBeUndefined();
  });

  it('drops availability when out-of-stock items are included', () => {
    const query = buildProductQuery({ ...DEFAULT_PLP_STATE, inStock: false }, { gender: 'men', page: 1, perPage: 24 });
    expect(query.availability).toBeUndefined();
  });
});

describe('toggleListValue', () => {
  it('adds then removes a value', () => {
    expect(toggleListValue([], 'Red')).toEqual(['Red']);
    expect(toggleListValue(['Red', 'Blue'], 'Red')).toEqual(['Blue']);
  });
});

describe('activePlpChips', () => {
  it('is empty for the default state', () => {
    expect(activePlpChips(DEFAULT_PLP_STATE)).toEqual([]);
  });

  it('creates one chip per active filter and removing a chip clears only that filter', () => {
    const state = {
      ...DEFAULT_PLP_STATE,
      category: 'bridal',
      colors: ['Red', 'Green'],
      rating: '4',
      minPrice: '2000',
      maxPrice: '5000',
    };
    const chips = activePlpChips(state);
    expect(chips.map(chip => chip.label)).toEqual(['Bridal', '₹2,000 - ₹5,000', '4★ & above', 'Red', 'Green']);
    const withoutRed = chips.find(chip => chip.key === 'color:Red')!.next;
    expect(withoutRed.colors).toEqual(['Green']);
    expect(withoutRed.category).toBe('bridal');
  });
});

describe('clearedPlpState', () => {
  it('resets filters but keeps the sort order', () => {
    const state = { ...DEFAULT_PLP_STATE, sort: 'price_desc', colors: ['Red'], inStock: false };
    expect(clearedPlpState(state)).toEqual({ ...DEFAULT_PLP_STATE, sort: 'price_desc' });
  });
});

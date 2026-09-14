import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTE_KEYS,
  DEFAULT_PLP_STATE,
  activePlpChips,
  buildProductQuery,
  clearedPlpState,
  parsePlpParams,
  plpStateToParams,
  plpTotalLabel,
  slugToLabel,
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
      attributes: { fabric: ['Pure silk'] },
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
      { ...DEFAULT_PLP_STATE, colors: ['Red', 'Green'], attributes: { fabric: ['Silk'] }, maxPrice: '9000' },
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

describe('attribute filters', () => {
  it('round-trips attribute selections through the URL', () => {
    const state = { ...DEFAULT_PLP_STATE, attributes: { fabric: ['kanjivaram-silk'], zari: ['real-gold-zari'] } };
    const params = plpStateToParams(state);
    expect(params.get('fabric')).toBe('kanjivaram-silk');
    expect(params.get('zari')).toBe('real-gold-zari');
    expect(parsePlpParams(params).attributes).toEqual(state.attributes);
  });

  it('accepts the legacy ?fabrics= param and re-serializes it as ?fabric=', () => {
    const parsed = parsePlpParams(new URLSearchParams('fabrics=kanjivaram-silk'));
    expect(parsed.attributes.fabric).toEqual(['kanjivaram-silk']);
    expect(plpStateToParams(parsed).get('fabric')).toBe('kanjivaram-silk');
    expect(plpStateToParams(parsed).get('fabrics')).toBeNull();
  });

  it('accepts an attribute key outside ATTRIBUTE_KEYS when the caller declares it known, and round-trips it', () => {
    // Simulates the backend adding an 8th attribute group (e.g. `pattern`) that facets has just
    // declared (CatalogPlp.tsx unions ATTRIBUTE_KEYS with the live facets.attributes[].key list
    // and passes that as `knownAttributeKeys`) — it must still filter, not silently no-op (C1).
    const knownAttributeKeys = [...ATTRIBUTE_KEYS, 'pattern'];
    const parsed = parsePlpParams(new URLSearchParams('pattern=ikat'), knownAttributeKeys);
    expect(parsed.attributes).toEqual({ pattern: ['ikat'] });
    const params = plpStateToParams(parsed);
    expect(params.get('pattern')).toBe('ikat');
    expect(parsePlpParams(params, knownAttributeKeys).attributes).toEqual(parsed.attributes);
  });

  it('still ignores known non-attribute params for the purposes of attribute parsing', () => {
    // category/sort/rating/etc. are never attribute-shaped, known keys or not.
    const parsed = parsePlpParams(new URLSearchParams('category=bridal&sort=newest&rating=4'));
    expect(parsed.attributes).toEqual({});
  });

  it('treats an undeclared key as inert, not as an attribute group, even if it looks attribute-shaped', () => {
    // Regression (C1 follow-up): a blocklist approach ("anything not a known non-attribute
    // field is an attribute") swept arbitrary URL noise into `attributes`, which then rendered
    // as removable filter chips and got forwarded to the products/facets API. Only
    // ATTRIBUTE_KEYS (or whatever the caller explicitly passes as `knownAttributeKeys`, e.g.
    // from live facets) may become an attribute group — everything else stays inert.
    const parsed = parsePlpParams(new URLSearchParams('pattern=ikat'));
    expect(parsed.attributes).toEqual({});
  });

  it('never turns marketing/pagination URL noise into phantom filter chips', () => {
    // The exact regression the reviewer caught: the PLP is a paid/marketing landing page, so
    // utm_source/gclid/fbclid-style params and `page` are exactly the noise a real URL carries.
    // None of it is attribute-shaped, so none of it may become a chip.
    const parsed = parsePlpParams(new URLSearchParams('utm_source=newsletter&gclid=abc&page=2'));
    expect(parsed.attributes).toEqual({});
    expect(activePlpChips(parsed)).toEqual([]);
  });

  it('drops empty attribute groups rather than emitting blank params', () => {
    const state = { ...DEFAULT_PLP_STATE, attributes: { fabric: [] } };
    expect(plpStateToParams(state).has('fabric')).toBe(false);
  });

  it('sends one query param per attribute group', () => {
    const state = { ...DEFAULT_PLP_STATE, attributes: { fabric: ['a', 'b'], work: ['woven'] } };
    const query = buildProductQuery(state, { gender: 'women', page: 1, perPage: 24 });
    expect(query.fabric).toBe('a,b');
    expect(query.work).toBe('woven');
    expect(query.zari).toBeUndefined();
  });

  it('counts each selected attribute value in the active-chip list', () => {
    const state = { ...DEFAULT_PLP_STATE, attributes: { fabric: ['kanjivaram-silk'], work: ['woven'] } };
    const chips = activePlpChips(state);
    expect(chips.filter(chip => chip.key.startsWith('attr:')).length).toBe(2);
  });
});

describe('slugToLabel', () => {
  it('title-cases each hyphen-separated word', () => {
    expect(slugToLabel('daily-wear')).toBe('Daily Wear');
    expect(slugToLabel('bridal')).toBe('Bridal');
    expect(slugToLabel('-kanjivaram--silk-')).toBe('Kanjivaram Silk');
  });

  it('labels the category chip the same way as the PLP heading', () => {
    const chips = activePlpChips({ ...DEFAULT_PLP_STATE, category: 'daily-wear' });
    expect(chips[0].label).toBe(slugToLabel('daily-wear'));
  });
});

describe('plpTotalLabel', () => {
  it('reads as loading only before the first count is known', () => {
    expect(plpTotalLabel(null, true)).toBe('Loading…');
    expect(plpTotalLabel(1200, true)).toBe('1,200');
  });

  it('formats a known count in en-IN and treats null as zero once idle', () => {
    expect(plpTotalLabel(125000, false)).toBe('1,25,000');
    expect(plpTotalLabel(null, false)).toBe('0');
  });
});

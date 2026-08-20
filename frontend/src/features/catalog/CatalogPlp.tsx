import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowUpDown, SlidersHorizontal, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useCatalogLiveRefresh } from '@/lib/useCatalogLiveRefresh';
import { liveStatusLabel } from '@/lib/liveStatus';
import { ProductGridSkeleton } from '@/ui/components';
import type { CatalogFacets, Product } from '@/types';
import { ProductCard } from './components/ProductCard';
import { FilterSidebar } from './components/FilterSidebar';
import { FALLBACK_SORTS, PlpSortBar } from './components/PlpSortBar';
import { PlpBanners, type PlpBannerSlide, type PlpCategoryTile } from './components/PlpBanners';
import {
  ATTRIBUTE_KEYS,
  buildProductQuery,
  clearedPlpState,
  parsePlpParams,
  plpStateToParams,
  type PlpFilterState,
} from './plpFilters';

interface CatalogPlpProps {
  gender: 'women' | 'men';
  title: string;
  slides: PlpBannerSlide[];
  tiles: PlpCategoryTile[];
}

const PER_PAGE = 24;

export function CatalogPlp({ gender, title, slides, tiles }: CatalogPlpProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState<Product[]>([]);
  const [facets, setFacets] = useState<CatalogFacets | null>(null);
  // ATTRIBUTE_KEYS unioned with whatever groups the live facets response declares — a positive
  // allowlist, not "every URL param that isn't a known non-attribute field" (that was tried and
  // let utm_source/gclid/page-style URL noise become phantom filter chips; see plpFilters.ts).
  // Before facets load, only ATTRIBUTE_KEYS is known; once they load, a backend-added group
  // (e.g. `pattern`) becomes recognized and the URL re-parses to pick it up.
  const knownAttributeKeys = useMemo(
    () => new Set<string>([...ATTRIBUTE_KEYS, ...(facets?.attributes || []).map(group => group.key)]),
    [facets],
  );
  const state = useMemo(
    () => parsePlpParams(searchParams, knownAttributeKeys),
    [searchParams, knownAttributeKeys],
  );

  const [total, setTotal] = useState<number | null>(null);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const requestId = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('plp-locked', drawerOpen || sortSheetOpen);
    return () => document.body.classList.remove('plp-locked');
  }, [drawerOpen, sortSheetOpen]);

  const applyState = useCallback(
    (next: PlpFilterState) => {
      setSearchParams(plpStateToParams(next));
    },
    [setSearchParams],
  );

  const loadFacets = useCallback(() => {
    const query = buildProductQuery(state, { gender, page: 1, perPage: PER_PAGE });
    delete query.page;
    delete query.per_page;
    delete query.sort;
    return api.products.facets(query).then(setFacets).catch(() => setFacets(null));
  }, [gender, state]);

  const loadFirstPage = useCallback(() => {
    const id = ++requestId.current;
    setLoading(true);
    return api.products
      .list(buildProductQuery(state, { gender, page: 1, perPage: PER_PAGE }))
      .then(data => {
        if (requestId.current !== id) return;
        setProducts(data.items);
        setTotal(data.total ?? data.items.length);
        setPages(data.pages ?? 1);
        setPage(1);
      })
      .catch(() => {
        if (requestId.current !== id) return;
        setProducts([]);
        setTotal(0);
        setPages(1);
        setPage(1);
      })
      .finally(() => {
        if (requestId.current === id) setLoading(false);
      });
  }, [gender, state]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || page >= pages) return;
    const id = requestId.current;
    const nextPage = page + 1;
    setLoadingMore(true);
    api.products
      .list(buildProductQuery(state, { gender, page: nextPage, perPage: PER_PAGE }))
      .then(data => {
        if (requestId.current !== id) return;
        setProducts(current => {
          const seen = new Set(current.map(product => product.id));
          return [...current, ...data.items.filter(product => !seen.has(product.id))];
        });
        setPage(nextPage);
        setPages(data.pages ?? pages);
        setTotal(data.total ?? total);
      })
      .catch(() => undefined)
      .finally(() => setLoadingMore(false));
  }, [gender, state, page, pages, total, loading, loadingMore]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  useEffect(() => {
    void loadFacets();
  }, [loadFacets]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) loadMore();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  const realtimeStatus = useCatalogLiveRefresh({
    gender,
    onUpdate: () => {
      void loadFirstPage();
      void loadFacets();
    },
  });

  return (
    <div className="plp" data-plp-gender={gender}>
      <PlpBanners
        slides={slides}
        tiles={tiles}
        activeCategory={state.category}
        onCategory={key => applyState({ ...state, category: key })}
      />

      <div className="plp-body">
        <aside className="plp-aside">
          <FilterSidebar facets={facets} state={state} onChange={applyState} />
        </aside>

        <main className="plp-main">
          <PlpSortBar
            title={title}
            total={total}
            loading={loading}
            facets={facets}
            state={state}
            liveChip={{ className: realtimeStatus, label: liveStatusLabel(realtimeStatus, 'stock') }}
            onChange={applyState}
          />

          {loading ? (
            <ProductGridSkeleton />
          ) : products.length === 0 ? (
            <div className="catalog-empty">
              <div className="catalog-empty-mark">CSM</div>
              <h2>No products match these filters</h2>
              <p>Try removing a filter or two, or clear them all.</p>
              <button type="button" className="btn btn-primary" onClick={() => applyState(clearedPlpState(state))}>
                Clear all filters
              </button>
            </div>
          ) : (
            <>
              <div className="plp-grid">
                {products.map(product => (
                  <ProductCard key={product.id} product={product} layout="nykaa" />
                ))}
              </div>
              <div ref={sentinelRef} className="plp-sentinel" aria-hidden="true" />
              <div className="plp-grid-footer">
                {loadingMore
                  ? 'Loading more…'
                  : total !== null && `Showing ${products.length.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')} items`}
              </div>
            </>
          )}
        </main>
      </div>

      <div className="plp-mobile-bar">
        <button type="button" onClick={() => setSortSheetOpen(true)}>
          <ArrowUpDown size={15} /> Sort
        </button>
        <button type="button" onClick={() => setDrawerOpen(true)}>
          <SlidersHorizontal size={15} /> Filter
        </button>
      </div>

      {drawerOpen && (
        <div className="plp-overlay" role="dialog" aria-modal="true" aria-label="Filters">
          <button type="button" className="plp-overlay-shade" aria-label="Close filters" onClick={() => setDrawerOpen(false)} />
          <div className="plp-drawer">
            <div className="plp-drawer-head">
              <strong>Filters</strong>
              <button type="button" aria-label="Close" onClick={() => setDrawerOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="plp-drawer-body">
              <FilterSidebar facets={facets} state={state} onChange={applyState} />
            </div>
            <button type="button" className="plp-drawer-apply" onClick={() => setDrawerOpen(false)}>
              {total !== null ? `Show ${total.toLocaleString('en-IN')} items` : 'Show items'}
            </button>
          </div>
        </div>
      )}

      {sortSheetOpen && (
        <div className="plp-overlay" role="dialog" aria-modal="true" aria-label="Sort by">
          <button type="button" className="plp-overlay-shade" aria-label="Close sort" onClick={() => setSortSheetOpen(false)} />
          <div className="plp-sheet">
            <div className="plp-drawer-head">
              <strong>Sort By</strong>
              <button type="button" aria-label="Close" onClick={() => setSortSheetOpen(false)}>
                <X size={18} />
              </button>
            </div>
            {(facets?.sorts?.length ? facets.sorts : FALLBACK_SORTS).map(sort => (
              <label key={sort.key} className="plp-sheet-row">
                <input
                  type="radio"
                  name="plp-sort"
                  checked={state.sort === sort.key}
                  onChange={() => {
                    applyState({ ...state, sort: sort.key });
                    setSortSheetOpen(false);
                  }}
                />
                {sort.label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

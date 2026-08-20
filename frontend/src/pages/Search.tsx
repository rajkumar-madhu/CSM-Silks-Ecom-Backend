import { useEffect, useState } from 'react';
import { ArrowLeft, Search as SearchIcon } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CatalogToolbar } from '@/features/catalog/components/CatalogToolbar';
import { ProductCard } from '@/features/catalog/components/ProductCard';
import { api } from '@/lib/api';
import { ProductGridSkeleton } from '@/ui/components';
import type { CatalogFacets, Product } from '@/types';

export function Search() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [results, setResults] = useState<Product[]>([]);
  const [facets, setFacets] = useState<CatalogFacets | null>(null);
  const [sort, setSort] = useState('popularity');
  const [rating, setRating] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [inStock, setInStock] = useState(true);
  const [color, setColor] = useState('');
  const [fabric, setFabric] = useState('');
  const [occasion, setOccasion] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.products.facets().then(setFacets).catch(() => setFacets(null));
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setLoading(true);
      api.products.search({
        q: query.trim() || undefined,
        sort,
        rating,
        max_price: maxPrice,
        color: color || undefined,
        fabric: fabric || undefined,
        occasion: occasion || undefined,
        availability: inStock ? 'in_stock' : undefined,
        per_page: 48,
      })
        .then(data => setResults(data.items))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 180);
    return () => window.clearTimeout(id);
  }, [query, sort, rating, maxPrice, inStock, color, fabric, occasion]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setQuery(searchParams.get('q') || '');
    }, 0);
    return () => window.clearTimeout(id);
  }, [searchParams]);

  const runSearch = (value: string) => {
    const next = value.trim();
    setQuery(next);
    setSearchParams(next ? { q: next } : {});
  };

  const chips = ['Kanjivaram', 'Bridal', 'Men', 'Festive', 'Dhoti', 'Daily'];

  return (
    <div className="search-page">
      <div className="search-shell">
        <div className="search-top">
          <button className="back-btn" onClick={() => navigate('/')} aria-label="Back home">
            <ArrowLeft size={20} />
            <span className="back-btn-label">Home</span>
          </button>
          <div>
            <span>Store search</span>
            <h1>Find the right textile fast</h1>
          </div>
        </div>

        <form className="search-box" onSubmit={(event) => { event.preventDefault(); runSearch(query); }}>
          <SearchIcon size={20} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search sarees, silk shirts, dhotis..."
            autoFocus
          />
          <button type="submit">Search</button>
        </form>

        <div className="quick-chips">
          {chips.map((chip) => (
            <button key={chip} onClick={() => runSearch(chip)}>{chip}</button>
          ))}
        </div>

        <div className="result-count">
          {query.trim() ? `${results.length} result${results.length !== 1 ? 's' : ''} for "${query}"` : `All products (${results.length})`}
        </div>

        <CatalogToolbar
          facets={facets}
          sort={sort}
          rating={rating}
          availability={inStock}
          maxPrice={maxPrice}
          color={color}
          fabric={fabric}
          occasion={occasion}
          onSort={setSort}
          onRating={setRating}
          onAvailability={setInStock}
          onMaxPrice={setMaxPrice}
          onColor={setColor}
          onFabric={setFabric}
          onOccasion={setOccasion}
        />

        {loading ? (
          <ProductGridSkeleton />
        ) : (
          <div className="pg">
            {results.map(product => <ProductCard key={product.id} product={product} />)}
          </div>
        )}
      </div>
    </div>
  );
}

import { SlidersHorizontal } from 'lucide-react';
import { inr } from '@/lib/money';
import type { CatalogFacets } from '@/types';

interface CatalogToolbarProps {
  facets: CatalogFacets | null;
  sort: string;
  rating: string;
  availability: boolean;
  maxPrice: string;
  color?: string;
  fabric?: string;
  occasion?: string;
  onSort: (value: string) => void;
  onRating: (value: string) => void;
  onAvailability: (value: boolean) => void;
  onMaxPrice: (value: string) => void;
  onColor?: (value: string) => void;
  onFabric?: (value: string) => void;
  onOccasion?: (value: string) => void;
}

export function CatalogToolbar({
  facets,
  sort,
  rating,
  availability,
  maxPrice,
  color = '',
  fabric = '',
  occasion = '',
  onSort,
  onRating,
  onAvailability,
  onMaxPrice,
  onColor,
  onFabric,
  onOccasion,
}: CatalogToolbarProps) {
  const max = Number(facets?.price?.max_price || 25000);
  const colors = facets?.colors || [];
  const fabrics = facets?.fabrics || [];
  const occasions = facets?.occasions || [];

  return (
    <div className="catalog-toolbar">
      <div className="catalog-toolbar-title">
        <SlidersHorizontal size={16} />
        Filters
      </div>
      <label className="catalog-control">
        <span>Sort</span>
        <select value={sort} onChange={(event) => onSort(event.target.value)}>
          {(facets?.sorts || [
            { key: 'popularity', label: 'Popularity' },
            { key: 'price_asc', label: 'Price: Low to High' },
            { key: 'price_desc', label: 'Price: High to Low' },
            { key: 'discount', label: 'Biggest Discount' },
          ]).map((item) => (
            <option key={item.key} value={item.key}>{item.label}</option>
          ))}
        </select>
      </label>
      <label className="catalog-control">
        <span>Rating</span>
        <select value={rating} onChange={(event) => onRating(event.target.value)}>
          <option value="">Any rating</option>
          <option value="4">4 stars and above</option>
          <option value="4.5">4.5 stars and above</option>
        </select>
      </label>
      {onFabric && fabrics.length > 0 && (
        <label className="catalog-control">
          <span>Fabric</span>
          <select value={fabric} onChange={(event) => onFabric(event.target.value)}>
            <option value="">All fabrics</option>
            {fabrics.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
      )}
      {onOccasion && occasions.length > 0 && (
        <label className="catalog-control">
          <span>Occasion</span>
          <select value={occasion} onChange={(event) => onOccasion(event.target.value)}>
            <option value="">All occasions</option>
            {occasions.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
      )}
      <label className="catalog-control catalog-range">
        <span>Max price: {inr(maxPrice || max)}</span>
        <input
          type="range"
          min={1000}
          max={Math.max(max, 1000)}
          step={500}
          value={Number(maxPrice || max)}
          onChange={(event) => onMaxPrice(event.target.value)}
        />
      </label>
      {onColor && colors.length > 0 && (
        <div className="catalog-swatches">
          <span>Colour</span>
          <div className="catalog-swatch-row">
            {colors.map((item) => {
              const active = color === item.color_name;
              return (
                <button
                  key={`${item.color_name}-${item.color_hex}`}
                  type="button"
                  className={`catalog-swatch ${active ? 'on' : ''}`}
                  style={{ background: item.color_hex || '#c4923a' }}
                  title={item.color_name}
                  aria-label={item.color_name}
                  aria-pressed={active}
                  onClick={() => onColor(active ? '' : item.color_name)}
                />
              );
            })}
          </div>
        </div>
      )}
      <label className="catalog-check">
        <input
          type="checkbox"
          checked={availability}
          onChange={(event) => onAvailability(event.target.checked)}
        />
        In stock only
      </label>
    </div>
  );
}

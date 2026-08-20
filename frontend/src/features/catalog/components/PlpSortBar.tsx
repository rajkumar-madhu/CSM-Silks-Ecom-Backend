import { X } from 'lucide-react';
import { activePlpChips, clearedPlpState, type PlpFilterState } from '../plpFilters';
import type { CatalogFacets } from '@/types';

interface PlpSortBarProps {
  title: string;
  total: number | null;
  loading: boolean;
  facets: CatalogFacets | null;
  state: PlpFilterState;
  liveChip?: { className: string; label: string };
  onChange: (next: PlpFilterState) => void;
}

export const FALLBACK_SORTS = [
  { key: 'popularity', label: 'Popularity' },
  { key: 'price_asc', label: 'Price: Low to High' },
  { key: 'price_desc', label: 'Price: High to Low' },
  { key: 'discount', label: 'Biggest Discount' },
  { key: 'rating', label: 'Customer Rating' },
  { key: 'newest', label: 'Newest First' },
];

export function PlpSortBar({ title, total, loading, facets, state, liveChip, onChange }: PlpSortBarProps) {
  const chips = activePlpChips(state);
  const sorts = facets?.sorts?.length ? facets.sorts : FALLBACK_SORTS;

  return (
    <div className="plp-sortbar-wrap">
      <div className="plp-sortbar">
        <div className="plp-sortbar-title">
          <h1>{title}</h1>
          <span className="plp-sortbar-count">
            {loading && total === null ? 'Loading…' : `(${(total ?? 0).toLocaleString('en-IN')} Items)`}
          </span>
          {liveChip && <span className={`ws-chip ${liveChip.className}`}>{liveChip.label}</span>}
        </div>
        <label className="plp-sort-select">
          <span>Sort By :</span>
          <select value={state.sort} onChange={event => onChange({ ...state, sort: event.target.value })}>
            {sorts.map(sort => (
              <option key={sort.key} value={sort.key}>{sort.label}</option>
            ))}
          </select>
        </label>
      </div>
      {chips.length > 0 && (
        <div className="plp-chip-row">
          {chips.map(chip => (
            <button key={chip.key} type="button" className="plp-chip" onClick={() => onChange(chip.next)}>
              {chip.label}
              <X size={12} />
            </button>
          ))}
          <button type="button" className="plp-chip plp-chip--clear" onClick={() => onChange(clearedPlpState(state))}>
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

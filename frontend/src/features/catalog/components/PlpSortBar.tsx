import { X } from 'lucide-react';
import { FALLBACK_SORTS, activePlpChips, clearedPlpState, type PlpFilterState } from '../plpFilters';
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

export function PlpSortBar({ title, total, loading, facets, state, liveChip, onChange }: PlpSortBarProps) {
  const chips = activePlpChips(state);
  const sorts = facets?.sorts?.length ? facets.sorts : FALLBACK_SORTS;

  // Attribute chips carry the raw slug as `label` (plpFilters.ts is pure and has no facet
  // access); resolve it to the human-readable option label here, where facets are in scope.
  const attributeLabels = new Map<string, string>();
  for (const group of facets?.attributes || []) {
    for (const option of group.options) {
      attributeLabels.set(`${group.key}:${option.slug}`, option.label);
    }
  }

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
          {chips.map(chip => {
            const label = chip.attr ? attributeLabels.get(`${chip.attr.group}:${chip.attr.slug}`) || chip.label : chip.label;
            return (
              <button key={chip.key} type="button" className="plp-chip" onClick={() => onChange(chip.next)}>
                {label}
                <X size={12} />
              </button>
            );
          })}
          <button type="button" className="plp-chip plp-chip--clear" onClick={() => onChange(clearedPlpState(state))}>
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

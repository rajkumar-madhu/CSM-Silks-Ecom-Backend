import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  clearedPlpState,
  toggleListValue,
  type PlpFilterState,
} from '../plpFilters';
import type { CatalogAttributeGroup, CatalogFacets } from '@/types';

interface FilterSidebarProps {
  facets: CatalogFacets | null;
  state: PlpFilterState;
  onChange: (next: PlpFilterState) => void;
}

const PRICE_RANGES = [
  { key: 'p1', label: 'Under ₹2,000', min: '', max: '2000' },
  { key: 'p2', label: '₹2,000 - ₹5,000', min: '2000', max: '5000' },
  { key: 'p3', label: '₹5,000 - ₹10,000', min: '5000', max: '10000' },
  { key: 'p4', label: '₹10,000 - ₹20,000', min: '10000', max: '20000' },
  { key: 'p5', label: 'Above ₹20,000', min: '20000', max: '' },
];

const DISCOUNT_STEPS = ['10', '25', '40', '60'];
const RATING_STEPS = [
  { value: '4', label: '4★ & above' },
  { value: '4.5', label: '4.5★ & above' },
];

function FilterGroup({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`plp-filter-group ${open ? 'open' : ''}`}>
      <button type="button" className="plp-filter-group-head" onClick={() => setOpen(value => !value)} aria-expanded={open}>
        <span>{title}</span>
        <ChevronDown size={15} />
      </button>
      {open && <div className="plp-filter-group-body">{children}</div>}
    </section>
  );
}

function CheckRow({
  checked,
  label,
  count,
  swatch,
  onToggle,
}: {
  checked: boolean;
  label: string;
  count?: number;
  swatch?: string;
  onToggle: () => void;
}) {
  return (
    <label className="plp-check-row">
      <input type="checkbox" checked={checked} onChange={onToggle} />
      {swatch && <span className="plp-check-swatch" style={{ background: swatch }} aria-hidden="true" />}
      <span className="plp-check-label">{label}</span>
      {typeof count === 'number' && <span className="plp-check-count">({count})</span>}
    </label>
  );
}

const VISIBLE_OPTIONS = 8;

function AttributeGroup({
  group,
  state,
  onChange,
}: {
  group: CatalogAttributeGroup;
  state: PlpFilterState;
  onChange: (next: PlpFilterState) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const selected = state.attributes[group.key] || [];
  const visible = showAll ? group.options : group.options.slice(0, VISIBLE_OPTIONS);
  return (
    <FilterGroup title={group.label}>
      {visible.map(option => (
        <CheckRow
          key={option.slug}
          checked={selected.includes(option.slug)}
          label={option.label}
          count={option.count}
          onToggle={() =>
            onChange({
              ...state,
              attributes: { ...state.attributes, [group.key]: toggleListValue(selected, option.slug) },
            })
          }
        />
      ))}
      {group.options.length > VISIBLE_OPTIONS && (
        <button type="button" className="plp-filter-more" onClick={() => setShowAll(value => !value)}>
          {showAll ? 'Show less' : `Show all ${group.options.length}`}
        </button>
      )}
    </FilterGroup>
  );
}

export function FilterSidebar({ facets, state, onChange }: FilterSidebarProps) {
  const activeCount =
    (state.category ? 1 : 0) +
    (state.minPrice || state.maxPrice ? 1 : 0) +
    (state.discountMin ? 1 : 0) +
    (state.rating ? 1 : 0) +
    state.colors.length +
    Object.values(state.attributes).reduce((total, values) => total + values.length, 0) +
    state.occasions.length +
    (state.inStock ? 0 : 1);

  const categories = facets?.categories || [];
  const categoryCounts = facets?.category_counts;
  const colors = facets?.colors || [];
  const occasionRows = facets?.occasion_counts || (facets?.occasions || []).map(name => ({ name, count: undefined as number | undefined }));

  return (
    <div className="plp-filters">
      <div className="plp-filters-head">
        <strong>Filters</strong>
        {activeCount > 0 && (
          <button type="button" className="plp-clear-all" onClick={() => onChange(clearedPlpState(state))}>
            Clear all ({activeCount})
          </button>
        )}
      </div>

      {categories.length > 0 && (
        <FilterGroup title="Category">
          {categories.map(category => {
            const count = categoryCounts?.[category.slug];
            if (categoryCounts && !count && state.category !== category.slug) return null;
            const active = state.category === category.slug;
            return (
              <CheckRow
                key={category.slug}
                checked={active}
                label={category.name}
                count={count}
                onToggle={() => onChange({ ...state, category: active ? '' : category.slug })}
              />
            );
          })}
        </FilterGroup>
      )}

      <FilterGroup title="Price">
        {PRICE_RANGES.map(range => {
          const active = state.minPrice === range.min && state.maxPrice === range.max && (range.min !== '' || range.max !== '');
          return (
            <CheckRow
              key={range.key}
              checked={active}
              label={range.label}
              onToggle={() =>
                onChange(active ? { ...state, minPrice: '', maxPrice: '' } : { ...state, minPrice: range.min, maxPrice: range.max })
              }
            />
          );
        })}
      </FilterGroup>

      {colors.length > 0 && (
        <FilterGroup title="Colour">
          {colors.map(color => (
            <CheckRow
              key={`${color.color_name}-${color.color_hex}`}
              checked={state.colors.includes(color.color_name)}
              label={color.color_name}
              count={color.count}
              swatch={color.color_hex || '#c4923a'}
              onToggle={() => onChange({ ...state, colors: toggleListValue(state.colors, color.color_name) })}
            />
          ))}
        </FilterGroup>
      )}

      {(facets?.attributes || []).map(group => (
        <AttributeGroup key={group.key} group={group} state={state} onChange={onChange} />
      ))}

      {occasionRows.length > 0 && (
        <FilterGroup title="Occasion" defaultOpen={false}>
          {occasionRows.map(occasion => (
            <CheckRow
              key={occasion.name}
              checked={state.occasions.includes(occasion.name)}
              label={occasion.name}
              count={occasion.count}
              onToggle={() => onChange({ ...state, occasions: toggleListValue(state.occasions, occasion.name) })}
            />
          ))}
        </FilterGroup>
      )}

      <FilterGroup title="Discount" defaultOpen={false}>
        {DISCOUNT_STEPS.map(step => {
          const active = state.discountMin === step;
          return (
            <CheckRow
              key={step}
              checked={active}
              label={`${step}% off & more`}
              onToggle={() => onChange({ ...state, discountMin: active ? '' : step })}
            />
          );
        })}
      </FilterGroup>

      <FilterGroup title="Rating" defaultOpen={false}>
        {RATING_STEPS.map(step => {
          const active = state.rating === step.value;
          return (
            <CheckRow
              key={step.value}
              checked={active}
              label={step.label}
              onToggle={() => onChange({ ...state, rating: active ? '' : step.value })}
            />
          );
        })}
      </FilterGroup>

      <FilterGroup title="Availability" defaultOpen={false}>
        <CheckRow
          checked={!state.inStock}
          label="Include out of stock"
          onToggle={() => onChange({ ...state, inStock: !state.inStock })}
        />
      </FilterGroup>
    </div>
  );
}

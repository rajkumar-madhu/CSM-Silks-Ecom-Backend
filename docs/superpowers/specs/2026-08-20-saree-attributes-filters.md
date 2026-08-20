# Saree catalogue attributes + filters — Design Spec

**Date:** 2026-08-20 · **Scope:** CSM Silks catalogue — **sarees only**
**Builds on:** `2026-08-19-nykaa-plp-design.md` (PLP, sidebar, facet counts — already shipped)

## Goal

Give sarees a real attribute model so the PLP filter sidebar can offer the facets a silk buyer
actually shops by (Fabric, Weave, Zari, Border, Pallu, Work, Origin) instead of the two
free-text groups it has today, and so the PDP spec table stops being a hand-typed JSON blob.

Sarees only. Menswear keeps its current toolbar and gains no facet groups (see *Menswear* below
for the one place the change unavoidably touches it).

## Why the current shape can't carry filters

Live dev data, all 8 sarees, one variant each:

| product | `variant.fabric` | `variant.zari_type` | blouse | length | size |
|---|---|---|---|---|---|
| ruby-bridal-kanjivaram-silk | Pure Kanjivaram Silk | Real Gold Zari | ✓ | 6.30 | Free Size |
| royal-kanjivaram-gold-zari | Pure Kanjivaram Silk | Real Gold Zari | ✓ | 6.30 | Free Size |
| temple-border-kanjivaram | Kanjivaram Silk | Silver and Gold Zari | ✓ | 6.30 | Free Size |
| double-ikat-patola-silk | Pure Patola Silk | Real Gold Zari | ✓ | 6.30 | Free Size |
| banarasi-zari-brocade | Banarasi Silk | Silver Zari | ✓ | 6.30 | Free Size |
| handloom-tussar-natural-gold | Tussar Silk | Antique Zari | ✓ | 6.30 | Free Size |
| mysore-crepe-silk-emerald | Mysore Crepe Silk | Fine Zari Border | ✓ | 6.30 | Free Size |
| elegant-pastel-daily-silk | Soft Silk | Minimal Zari | ✓ | 6.30 | Free Size |

1. **Free text fragments.** `Kanjivaram Silk` and `Pure Kanjivaram Silk` are one fabric under two
   labels — today they render as two checkboxes that each hide half the Kanjivarams. 7 distinct
   fabric strings across 8 products makes the facet useless.
2. **Columns are mis-used.** `Fine Zari Border` is a *border*, not a zari type. Menswear rows are
   worse (`Self Weave`, `Thread Embroidery`, `Gold Border` all in `zari_type`). One column is
   absorbing three concepts because there is nowhere else to put them.
3. **Attributes with no variance are not filters.** blouse/length/size are identical on every
   saree. They belong on the PDP spec table; as facets they are single-option noise.
4. **Attributes the spec asks for have no home at all** — weave, pallu, work, origin, silk mark
   currently exist only as prose inside `Product.specifications` (a free-form JSON dict whose
   keys are typed per product by whoever created it).

## Data model

### `AttributeOption` — the controlled vocabulary (new, `catalog/models.py`)

```python
class AttributeOption(models.Model):
    key         = CharField(max_length=24, choices=Key.choices, db_index=True)
    value_slug  = SlugField(max_length=80)
    label       = CharField(max_length=120)
    sort_order  = PositiveIntegerField(default=0)
    is_filterable = BooleanField(default=True)
    is_active   = BooleanField(default=True)

    class Meta:
        unique_together = ("key", "value_slug")
        ordering = ["key", "sort_order", "label"]
```

`Key` choices: `fabric`, `weave`, `zari`, `border`, `pallu`, `work`, `origin`.

The governing rule: **adding a *value* is an admin action; adding an *attribute* is a migration.**
That is the whole point of the hybrid — it keeps the filterable surface typed and indexed while
letting merchandisers extend vocabularies without a deploy.

### `Product` gains seven FKs

All `null=True, blank=True, on_delete=PROTECT`, each `limit_choices_to={"key": ...}`:

`fabric`, `weave`, `zari`, `border`, `pallu`, `work`, `origin`

Saree design attributes are properties of the *design*, not of the colourway, so they sit on
`Product`. Plus one boolean: `silk_mark_certified` (the Silk Mark authenticity claim — it is a
yes/no certification, not a vocabulary).

### `ProductVariant` keeps the physical, per-piece attributes

Stays: `size`, `length_meters`, `blouse_included`, `care_instructions`.
Adds: `blouse_length_meters` (Decimal, null), `weight_grams` (PositiveInteger, null).

**Removed** from `ProductVariant`: `fabric`, `zari_type`. They move to the `Product` FKs above —
one source of truth, not two. `ProductVariantSerializer` keeps emitting `fabric` and `zari_type`
as read-only strings sourced from `product.fabric.label` / `product.zari.label`, so no API
consumer breaks.

### `Category.product_type`

New CharField, choices `saree` / `menswear` / `other`, default `other`. A data migration sets
`saree` on `banarasi, bridal, daily-silk, kanjivaram, mysore, patola, tussar` and `menswear` on
the five `mens-*` slugs.

Why not gate on `gender="women"`: today that is exactly equivalent to "is a saree", but only by
accident — the first women's kurti breaks it. Which attribute panel applies is a property of the
catalogue, not of a URL.

### `Product.specifications` — the dynamic tail

Unchanged and still free-form, but demoted to **display-only**: it renders as extra PDP spec rows
and is never a filter source. Typed attributes take precedence when both carry the same concept.

## Backfill migration

A single data migration, run in this order:

1. Create the seed vocabularies (below).
2. Map every existing `variant.fabric` / `variant.zari_type` string onto an option via an explicit
   lookup table in the migration. Notable mappings:
   - `Pure Kanjivaram Silk`, `Kanjivaram Silk` → **one** option `kanjivaram-silk`
   - `Pure Patola Silk` → `patola-silk`
   - `Silver and Gold Zari` → `gold-silver-zari`
   - `Fine Zari Border` → zari `gold-zari` **and** border `zari-border` (the split fix)
3. Any string not in the table creates an option with `is_filterable=False` and a
   `needs-review` marker in `label`, and is printed to stdout. The migration never silently drops
   a value and never guesses.
4. Leave `weave`, `border`, `pallu`, `work`, `origin`, `silk_mark_certified` **null**. They are
   not recoverable from `specifications`: its `Origin` key holds the boilerplate string
   "Kanchipuram curated collection" on all 8 products, including the Banarasi, Patola, Mysore and
   Tussar sarees. Backfilling it would put a false provenance claim on the storefront. A
   merchandiser sets these in admin; until then the products simply carry no origin.
5. Drop `ProductVariant.fabric` / `zari_type`.

Seed vocabularies (initial; merchandisers extend via admin):

- **fabric** — Kanjivaram Silk, Banarasi Silk, Patola Silk, Mysore Crepe Silk, Tussar Silk, Soft
  Silk, Silk Cotton, Dupion Silk, Raw Silk
- **weave** — Handloom, Powerloom, Jacquard, Ikat, Brocade
- **zari** — Real Gold Zari, Gold Zari, Silver Zari, Gold & Silver Zari, Antique Zari, Copper
  Zari, Minimal Zari, No Zari
- **border** — Temple Border, Zari Border, Contrast Border, Broad Border, Minimal Border
- **pallu** — Rich Zari Pallu, Contrast Pallu, Self Pallu, Printed Pallu
- **work** — Woven, Thread Work, Embroidery, Printed, Hand-painted, Stone & Bead Work
- **origin** — Kanchipuram, Varanasi, Patan, Mysore, Bhagalpur

## API

`catalog/selectors.py::public_products` accepts six new comma-separated multi-value params —
`weave`, `zari`, `border`, `pallu`, `work`, `origin` — matched on `value_slug`. OR within a
group, AND across groups, same semantics as the existing `colors`/`fabrics`.

`fabric` keeps its param name and now matches **either** `value_slug` or `label`
(case-insensitive), so links already in the wild keep working.

`/api/catalog/facets` gains one additive field:

```json
"attributes": [
  {"key": "fabric", "label": "Fabric", "options": [{"slug": "kanjivaram-silk", "label": "Kanjivaram Silk", "count": 3}]}
]
```

Emitted **only** when the queryset is saree-scoped (`category.product_type == "saree"`, or
`gender=women` with no category). Existing `fabrics` / `fabric_counts` / `occasion_counts` stay
for back-compat.

Two rules for the counts:

- A group is omitted entirely when it has fewer than 2 options with a non-zero count. This is
  what keeps "Blouse Included: Yes (8)" off the sidebar.
- **Each group's count is computed with that group's own filter removed** — standard multi-select
  facet semantics, so ticking "Kanjivaram Silk" does not zero out every other fabric. This applies
  to the new `attributes` block only; legacy `fabric_counts` / `occasion_counts` / `category_counts`
  keep their current fully-filtered semantics so existing clients and tests are unaffected.
  Plain ORM aggregation, one query per group — at 8 products, cost is irrelevant.

## Admin

- `AttributeOption` CRUD (list filtered by `key`, inline reorder, `is_filterable` toggle).
- `AdminProductWriteSerializer` gains the seven FK fields as slug-related fields.
- `AdminProductQuickCreateSerializer` — `fabric` and `zari_type` change from free `CharField` to
  a choice over existing option slugs. **This is the leak that created the drift**: quick-create
  is where operators type "Pure Kanjivaram Silk" by hand. Unknown values are rejected with a
  message naming the admin screen, not silently created.
- The `specifications` dict quick-create writes stops duplicating Fabric/Blouse (now typed).

## Frontend (`frontend/src/features/catalog/`)

- **`plpFilters.ts`** — `PlpFilterState` gains `attributes: Record<string, string[]>`, serialized
  as one URL param per attribute key (`?fabric=kanjivaram-silk&zari=real-gold-zari`). Note the
  rename: the sidebar's fabric group moves out of the existing `state.fabrics` /
  `?fabrics=` param into `state.attributes.fabric` / `?fabric=`, so all seven groups share one
  code path. `?fabrics=` is still **accepted on parse** as a legacy alias and re-serialized as
  `?fabric=`, so old links keep working and redirect themselves on the next interaction. Parse
  ignores unknown keys. Round-trip property covered by the existing `plpFilters.test.ts`.
- **`FilterSidebar.tsx`** — renders `facets.attributes` **generically** in a loop instead of the
  hardcoded Fabric/Occasion groups, so a new attribute needs no frontend change. Group order
  follows the API. Groups over 8 options collapse behind "Show all".
- **`PlpSortBar.tsx`** — active-filter chips already generic over lists; extend to the new keys.
- **PDP** — spec table renders the typed attributes as named rows first (Fabric, Weave, Zari,
  Border, Pallu, Work, Origin, Silk Mark, Saree Length, Blouse Length, Blouse Piece, Weight, Wash
  Care), then any remaining `specifications` keys. Null attributes are omitted, not shown blank.
- Women's PLP only. `Mens.tsx` and `Search.tsx` are untouched.

## Menswear (the one unavoidable spillover)

The dropped `variant.fabric` / `zari_type` columns are shared, so the backfill must give menswear
rows a home too — its 5 values land in the same `AttributeOption` table under the same keys. What
menswear does **not** get: facet groups, a filter sidebar, or PDP spec-table changes. The user
scope ("only sarees") constrains the UX; the migration cannot be half-applied to a shared column.

## Error handling / edge cases

- Facet fetch failure → sidebar falls back to the existing static groups (already the behaviour).
- A filter param naming an unknown slug → ignored, not a 400 (shareable links must not rot when a
  merchandiser retires an option).
- Retiring an option: `is_active=False` hides it from facets and admin choices but leaves products
  pointing at it, so the PDP keeps rendering. `PROTECT` prevents deletion while in use.
- A saree with all attributes null renders no spec rows rather than a table of dashes, and appears
  under no facet — visible only via category/price/colour.
- Empty result set → existing empty state + Clear All.

## Testing

Backend, from `backend/`, `SECURE_SSL_REDIRECT=false python manage.py test catalog`:

- Backfill collapses `Pure Kanjivaram Silk` + `Kanjivaram Silk` to one option (3 products).
- `Fine Zari Border` splits into zari + border.
- An unmapped string survives as `is_filterable=False` rather than being dropped.
- Multi-select: `?fabric=a,b` returns the union; `?fabric=a&zari=b` returns the intersection.
- Facet counts exclude their own group's filter.
- A group with one option is omitted from `attributes`.
- Menswear query returns no `attributes` block.
- Legacy `?fabric=Kanjivaram%20Silk` (label form) still filters.
- Legacy `?fabrics=` URL alias parses into `attributes.fabric` and re-serializes as `?fabric=`.

Frontend: `npm run lint`, `npm test` (plpFilters round-trip incl. new keys), `npm run build`.
Visual: `run-csm-silks-ecom` skill → desktop + mobile `/womens` with two facets applied, and a PDP.

## Out of scope

Menswear facets; search-page facets; PDP visual redesign; admin dashboard; importing a real saree
catalogue; deployment (separate: `docker build` → Harbor push → `rollout restart`).

# Nykaa-style Product Listing Page (PLP) — Design Spec

**Date:** 2026-08-19 · **Scope:** CSM Silks storefront category pages (`/womens`, `/mens`)
**Reference:** https://www.nykaafashion.com/women/c/6557 (full visual clone, per user direction)

## Goal

Replace the current hero + chip-bar + horizontal-toolbar category pages with a Nykaa
Fashion-style PLP: promo banner carousel, circular category tiles, left filter sidebar with
facet counts and multi-select, URL-synced filters/sort, and infinite scroll. Approved features
(user selected "Both" project-wide; this spec covers sub-project 1 — the PLP; the admin
dashboard visualization is sub-project 2, spec'd separately):

1. Filter sidebar with facet counts (backend: counts added to `/api/catalog/facets`).
2. URL-synced filters + sort (shareable links, back/forward works).
3. Infinite scroll using the pagination the API already returns.
4. Banner carousel + circular category tiles above the grid.

## Backend changes (`backend/catalog/`)

- `selectors.py::public_products`: `color`, `fabric`, `occasion` accept **comma-separated
  multi-values** (OR within a facet, AND across facets). Backward compatible — single values
  behave as before.
- `views.py::CatalogFacetsView`: additive fields, nothing removed:
  - `total` — product count for the current query.
  - `colors[*].count` — distinct products per color.
  - `fabric_counts: [{name, count}]` (existing `fabrics: string[]` kept).
  - `occasion_counts: [{name, count}]` (existing `occasions: string[]` kept).
  - `category_counts: {slug: count}`.
- Tests: new `CatalogFacetCountTests` covering counts + multi-value filters.

## Frontend changes (`frontend/src/`)

New shared page `features/catalog/CatalogPlp.tsx` (Womens/Mens become thin config wrappers;
`Search.tsx` and the old `CatalogToolbar` untouched):

- **`features/catalog/plpFilters.ts`** — pure, unit-tested (`plpFilters.test.ts`, `.ts` so
  vitest picks it up): parse/serialize filter state ↔ URLSearchParams, toggle helpers,
  active-chip derivation, API query building.
- **`PlpBanners.tsx`** — auto-rotating promo carousel (existing `/images/catalog/*.jpg`) +
  circular category tiles (Nykaa "shop by category" row). Mens keeps its WhatsApp-stylist CTA
  as a banner slide.
- **`FilterSidebar.tsx`** — sticky left rail: "FILTERS" header + Clear All, collapsible groups
  (Category, Price presets + custom, Discount, Color swatches, Fabric, Occasion, Rating,
  Availability) with counts; multi-select checkboxes for color/fabric/occasion.
- **`PlpSortBar.tsx`** — "Sarees **(1,240 items)**", active-filter chips (x to remove), and a
  Nykaa-style "Sort By:" dropdown.
- **Infinite scroll** — IntersectionObserver sentinel appends pages (`per_page` 24), "showing
  X of Y" footer; resets on filter change. Realtime stock refresh (SSE/WS) reloads page 1.
- **ProductCard `layout="nykaa"`** — 3:4 image, hover second image + quick-shop, wishlist
  heart, rating pill on image (`4.2 ★ | 89`), brand line "CSM Silks", grey product name,
  `₹1,299 ₹2,599 (50% Off)` price row with pink discount.
- **`styles/plp.css`** — Nykaa visual language: white surface, pink accent `#fc2779`, ink
  `#001325`, hairline dividers `#eaeaec`, dense grid (4-col desktop → 2-col mobile). Dark-mode
  overrides via existing `[data-theme]` tokens. Mobile: sidebar becomes a slide-in drawer,
  sticky bottom **Sort | Filter** bar (Nykaa mobile pattern).

## Error handling / edge cases

- Facet fetch failure → sidebar renders static groups without counts (as today).
- Empty results → existing empty state, plus one-click Clear All.
- Unknown/garbage URL params are ignored on parse.

## Testing

- Backend: `SECURE_SSL_REDIRECT=false python manage.py test catalog` (from `backend/`).
- Frontend: `npm run lint`, `npm test` (plpFilters unit tests), `npm run build` (tsc gate).
- Visual: `run-csm-silks-ecom` skill → desktop + mobile screenshots of `/womens`.

## Out of scope

Admin dashboard + charts (sub-project 2), `Search.tsx` redesign, backend facet counts for
search page, deployment to wecrew (separate step: docker build → Harbor push → rollout restart).

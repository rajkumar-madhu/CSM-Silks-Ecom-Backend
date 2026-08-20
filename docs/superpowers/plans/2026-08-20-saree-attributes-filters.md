# Saree Catalogue Attributes + Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace free-text saree attributes with a controlled vocabulary so the PLP can offer Fabric / Weave / Zari / Border / Pallu / Work / Origin facets and the PDP can render a typed spec table.

**Architecture:** A single `AttributeOption` table holds every controlled value, keyed by attribute (`key` + `value_slug`). `Product` gains seven nullable FKs into it; the free-text `ProductVariant.fabric` / `zari_type` columns are backfilled into those FKs and dropped, leaving one source of truth. `Category.product_type` marks which categories are sarees, so the facet API knows which attribute panel applies. Facet counts are plain ORM aggregation — the catalogue is 15 products.

**Tech Stack:** Django 6.0.5 + DRF (backend, `backend/`), React 19 + Vite + TypeScript (frontend, `frontend/`), SQLite in dev / Postgres in cluster.

**Spec:** `docs/superpowers/specs/2026-08-20-saree-attributes-filters.md`

## Global Constraints

- **Sarees only.** Menswear gets no facet groups, no sidebar changes, no PDP spec-table changes. The only menswear contact is the backfill, because the dropped columns are shared.
- **Run all backend tests from `backend/`**, never the repo root — root-level `accounts/`, `ai/` etc. shadow the real apps and report "Found 0 test(s)" with exit 0. The system `python3` has no Django; use `../.venv/bin/python`.
- **Backend test command:** `cd backend && SECURE_SSL_REDIRECT=false ../.venv/bin/python manage.py test catalog`
- **Frontend commands run from `frontend/`:** `npm run lint`, `npm test`, `npm run build` (`npm run build` runs `tsc -b` first — a type error fails the build).
- **Frontend vitest only picks up `src/**/*.test.ts`** — `.tsx` test files are NOT collected. New tests go in `.ts` files.
- **Never invent attribute values.** Where the spec says leave a field null, leave it null. Specifically: do NOT backfill `origin` from `Product.specifications["Origin"]` — it is the boilerplate string `"Kanchipuram curated collection"` on all 8 sarees including the Banarasi, Patola, Mysore and Tussar, and migrating it would publish a false provenance claim.
- **Legacy facet fields stay.** `fabrics`, `fabric_counts`, `occasions`, `occasion_counts`, `category_counts` keep their current names AND their current fully-filtered count semantics. Own-filter exclusion applies to the new `attributes` block only.
- **Migrations:** the next catalog migration number is `0004`. `makemigrations --check --dry-run` is currently clean — keep it clean at the end of every task.
- **Commit per task**, `git add` only the files that task names.

---

### Task 1: `AttributeOption` model, `Category.product_type`, seed vocabularies

**Files:**
- Modify: `backend/catalog/models.py` (add `AttributeOption`; add `product_type` to `Category`)
- Create: `backend/catalog/migrations/0004_attributeoption_category_product_type.py` (generated)
- Create: `backend/catalog/migrations/0005_seed_attribute_options.py` (hand-written data migration)
- Test: `backend/catalog/tests.py` (append `AttributeOptionSeedTests`)

**Interfaces:**
- Consumes: nothing.
- Produces: `catalog.models.AttributeOption` with fields `key`, `value_slug`, `label`, `sort_order`, `is_filterable`, `is_active`, and inner class `AttributeOption.Key` with members `FABRIC="fabric"`, `WEAVE="weave"`, `ZARI="zari"`, `BORDER="border"`, `PALLU="pallu"`, `WORK="work"`, `ORIGIN="origin"`. `Category.product_type` with `Category.ProductType.SAREE="saree"`, `MENSWEAR="menswear"`, `OTHER="other"`.

- [ ] **Step 1: Write the failing test**

Append to `backend/catalog/tests.py`:

```python
class AttributeOptionSeedTests(TestCase):
    def test_seed_migration_creates_vocabularies(self):
        from catalog.models import AttributeOption

        fabrics = set(
            AttributeOption.objects.filter(key=AttributeOption.Key.FABRIC).values_list("value_slug", flat=True)
        )
        self.assertIn("kanjivaram-silk", fabrics)
        self.assertIn("patola-silk", fabrics)
        self.assertEqual(AttributeOption.objects.filter(key=AttributeOption.Key.ZARI).count(), 8)
        self.assertEqual(AttributeOption.objects.filter(key=AttributeOption.Key.WEAVE).count(), 5)

    def test_key_and_slug_are_unique_together(self):
        from django.db.utils import IntegrityError
        from catalog.models import AttributeOption

        AttributeOption.objects.create(key=AttributeOption.Key.WORK, value_slug="woven", label="Woven")
        with self.assertRaises(IntegrityError):
            AttributeOption.objects.create(key=AttributeOption.Key.WORK, value_slug="woven", label="Woven Again")

    def test_same_slug_allowed_under_different_keys(self):
        from catalog.models import AttributeOption

        AttributeOption.objects.create(key=AttributeOption.Key.BORDER, value_slug="temple", label="Temple Border")
        AttributeOption.objects.create(key=AttributeOption.Key.PALLU, value_slug="temple", label="Temple Pallu")
        self.assertEqual(AttributeOption.objects.filter(value_slug="temple").count(), 2)

    def test_category_product_type_marks_sarees_and_menswear(self):
        from catalog.models import Category

        saree = Category.objects.create(name="Patola", slug="patola-test", gender="women")
        self.assertEqual(saree.product_type, Category.ProductType.OTHER)
        saree.product_type = Category.ProductType.SAREE
        saree.save(update_fields=["product_type"])
        self.assertEqual(Category.objects.filter(product_type="saree").count(), 1)
```

Note: `test_seed_migration_creates_vocabularies` passes because Django runs all migrations — including data migrations — when building the test database.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && SECURE_SSL_REDIRECT=false ../.venv/bin/python manage.py test catalog.tests.AttributeOptionSeedTests
```
Expected: FAIL — `ImportError: cannot import name 'AttributeOption'`.

- [ ] **Step 3: Add the model and the category field**

In `backend/catalog/models.py`, add `ProductType` to `Category` (immediately after the existing `Gender` inner class) and the `product_type` field after `gender`:

```python
class Category(models.Model):
    class Gender(models.TextChoices):
        WOMEN = "women", "Women"
        MEN = "men", "Men"
        UNISEX = "unisex", "Unisex"

    class ProductType(models.TextChoices):
        SAREE = "saree", "Saree"
        MENSWEAR = "menswear", "Menswear"
        OTHER = "other", "Other"

    name = models.CharField(max_length=120)
    slug = models.SlugField(unique=True)
    gender = models.CharField(max_length=10, choices=Gender.choices, default=Gender.WOMEN)
    # Which attribute panel applies. Deliberately NOT derived from `gender`: today
    # gender="women" happens to mean "is a saree", but the first women's kurti breaks that.
    product_type = models.CharField(max_length=10, choices=ProductType.choices, default=ProductType.OTHER, db_index=True)
```

Add `AttributeOption` at the end of `backend/catalog/models.py`:

```python
class AttributeOption(models.Model):
    """Controlled vocabulary for filterable saree attributes.

    The governing rule: adding a *value* is an admin action; adding an *attribute*
    is a migration. Free text on ProductVariant.fabric fragmented into
    "Kanjivaram Silk" vs "Pure Kanjivaram Silk" — two checkboxes for one fabric.
    """

    class Key(models.TextChoices):
        FABRIC = "fabric", "Fabric"
        WEAVE = "weave", "Weave"
        ZARI = "zari", "Zari"
        BORDER = "border", "Border"
        PALLU = "pallu", "Pallu"
        WORK = "work", "Work"
        ORIGIN = "origin", "Origin"

    key = models.CharField(max_length=24, choices=Key.choices, db_index=True)
    value_slug = models.SlugField(max_length=80)
    label = models.CharField(max_length=120)
    sort_order = models.PositiveIntegerField(default=0)
    is_filterable = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        unique_together = ("key", "value_slug")
        ordering = ["key", "sort_order", "label"]

    def __str__(self) -> str:
        return f"{self.get_key_display()}: {self.label}"
```

- [ ] **Step 4: Generate the schema migration**

```bash
cd backend && SECURE_SSL_REDIRECT=false ../.venv/bin/python manage.py makemigrations catalog
```
Expected: creates `0004_*.py` adding `AttributeOption` and `Category.product_type`.

- [ ] **Step 5: Write the seed data migration**

Create `backend/catalog/migrations/0005_seed_attribute_options.py`:

```python
from django.db import migrations

# (key, [(value_slug, label), ...]) — order in the list is the display order.
SEED = [
    ("fabric", [
        ("kanjivaram-silk", "Kanjivaram Silk"),
        ("banarasi-silk", "Banarasi Silk"),
        ("patola-silk", "Patola Silk"),
        ("mysore-crepe-silk", "Mysore Crepe Silk"),
        ("tussar-silk", "Tussar Silk"),
        ("soft-silk", "Soft Silk"),
        ("silk-cotton", "Silk Cotton"),
        ("dupion-silk", "Dupion Silk"),
        ("raw-silk", "Raw Silk"),
        ("silk-blend", "Silk Blend"),
        ("pure-silk", "Pure Silk"),
    ]),
    ("weave", [
        ("handloom", "Handloom"),
        ("powerloom", "Powerloom"),
        ("jacquard", "Jacquard"),
        ("ikat", "Ikat"),
        ("brocade", "Brocade"),
    ]),
    ("zari", [
        ("real-gold-zari", "Real Gold Zari"),
        ("gold-zari", "Gold Zari"),
        ("silver-zari", "Silver Zari"),
        ("gold-silver-zari", "Gold & Silver Zari"),
        ("antique-zari", "Antique Zari"),
        ("copper-zari", "Copper Zari"),
        ("minimal-zari", "Minimal Zari"),
        ("no-zari", "No Zari"),
    ]),
    ("border", [
        ("temple-border", "Temple Border"),
        ("zari-border", "Zari Border"),
        ("contrast-border", "Contrast Border"),
        ("broad-border", "Broad Border"),
        ("minimal-border", "Minimal Border"),
    ]),
    ("pallu", [
        ("rich-zari-pallu", "Rich Zari Pallu"),
        ("contrast-pallu", "Contrast Pallu"),
        ("self-pallu", "Self Pallu"),
        ("printed-pallu", "Printed Pallu"),
    ]),
    ("work", [
        ("woven", "Woven"),
        ("thread-work", "Thread Work"),
        ("embroidery", "Embroidery"),
        ("printed", "Printed"),
        ("hand-painted", "Hand-painted"),
        ("stone-bead-work", "Stone & Bead Work"),
    ]),
    ("origin", [
        ("kanchipuram", "Kanchipuram"),
        ("varanasi", "Varanasi"),
        ("patan", "Patan"),
        ("mysore", "Mysore"),
        ("bhagalpur", "Bhagalpur"),
    ]),
]

SAREE_CATEGORY_SLUGS = ["banarasi", "bridal", "daily-silk", "kanjivaram", "mysore", "patola", "tussar"]
MENSWEAR_CATEGORY_SLUGS = ["mens-dhoti", "mens-kurta", "mens-set", "mens-shirt", "mens-veshti"]


def seed(apps, schema_editor):
    AttributeOption = apps.get_model("catalog", "AttributeOption")
    Category = apps.get_model("catalog", "Category")
    for key, values in SEED:
        for index, (value_slug, label) in enumerate(values):
            AttributeOption.objects.update_or_create(
                key=key,
                value_slug=value_slug,
                defaults={"label": label, "sort_order": index * 10},
            )
    Category.objects.filter(slug__in=SAREE_CATEGORY_SLUGS).update(product_type="saree")
    Category.objects.filter(slug__in=MENSWEAR_CATEGORY_SLUGS).update(product_type="menswear")


def unseed(apps, schema_editor):
    AttributeOption = apps.get_model("catalog", "AttributeOption")
    Category = apps.get_model("catalog", "Category")
    for key, values in SEED:
        AttributeOption.objects.filter(key=key, value_slug__in=[slug for slug, _ in values]).delete()
    Category.objects.filter(slug__in=SAREE_CATEGORY_SLUGS + MENSWEAR_CATEGORY_SLUGS).update(product_type="other")


class Migration(migrations.Migration):
    dependencies = [("catalog", "0004_attributeoption_category_product_type")]
    operations = [migrations.RunPython(seed, unseed)]
```

If Step 4 named the migration something other than `0004_attributeoption_category_product_type`, fix the `dependencies` entry to match the real filename (without `.py`).

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd backend && SECURE_SSL_REDIRECT=false ../.venv/bin/python manage.py test catalog
```
Expected: PASS — `AttributeOptionSeedTests` 4/4, and every pre-existing catalog test still passing.

- [ ] **Step 7: Confirm no migration drift**

```bash
cd backend && SECURE_SSL_REDIRECT=false ../.venv/bin/python manage.py makemigrations --check --dry-run
```
Expected: "No changes detected".

- [ ] **Step 8: Commit**

```bash
git add backend/catalog/models.py backend/catalog/migrations/ backend/catalog/tests.py
git commit -m "feat(catalog): add AttributeOption vocabulary and Category.product_type"
```

---

### Task 2: Product attribute FKs, backfill, drop the free-text variant columns

This is the load-bearing task. It moves fabric/zari off `ProductVariant`, backfills all 15 existing variants, and keeps the API shape identical.

**Files:**
- Modify: `backend/catalog/models.py` (seven FKs + `silk_mark_certified` on `Product`; `blouse_length_meters` + `weight_grams` on `ProductVariant`; remove `fabric` and `zari_type` from `ProductVariant`)
- Create: `backend/catalog/migrations/0006_product_attributes.py` (generated: add fields)
- Create: `backend/catalog/migrations/0007_backfill_attributes.py` (hand-written data migration)
- Create: `backend/catalog/migrations/0008_drop_variant_fabric_zari.py` (generated: remove fields)
- Modify: `backend/catalog/serializers.py` (variant read-through; quick-create write path)
- Modify: `backend/catalog/selectors.py:20-22` (Prefetch `select_related`)
- Modify: `backend/catalog/management/commands/seed_csm.py:425` (seed writes FKs, not strings)
- Modify: `backend/catalog/tests.py` (existing `CatalogFacetCountTests.setUp` sets `fabric=` on variants — must move to product FKs)
- Test: `backend/catalog/tests.py` (append `SareeAttributeBackfillTests`)

**Interfaces:**
- Consumes: `AttributeOption`, `AttributeOption.Key` from Task 1.
- Produces: `Product.fabric`, `Product.weave`, `Product.zari`, `Product.border`, `Product.pallu`, `Product.work`, `Product.origin` — all `ForeignKey(AttributeOption, null=True)`; `Product.silk_mark_certified: bool`. `ProductVariantSerializer` still emits string keys `fabric` and `zari_type` (now read-only, sourced from the product FK labels) — later tasks and the frontend rely on that.

- [ ] **Step 1: Write the failing test**

Append to `backend/catalog/tests.py`:

```python
class SareeAttributeBackfillTests(TestCase):
    """The backfill is the whole point of this task: it must collapse duplicate
    fabric labels, move a border value out of the zari column, and never silently
    drop an unrecognised string."""

    def test_duplicate_fabric_labels_collapse_to_one_option(self):
        from catalog.migrations import _attribute_backfill as backfill

        self.assertEqual(backfill.FABRIC_MAP["Pure Kanjivaram Silk"], "kanjivaram-silk")
        self.assertEqual(backfill.FABRIC_MAP["Kanjivaram Silk"], "kanjivaram-silk")

    def test_fine_zari_border_splits_into_zari_and_border(self):
        from catalog.migrations import _attribute_backfill as backfill

        self.assertEqual(backfill.ZARI_MAP["Fine Zari Border"], ("gold-zari", "zari-border"))

    def test_every_known_zari_string_is_mapped(self):
        from catalog.migrations import _attribute_backfill as backfill

        # Every distinct zari_type string present in the seeded catalogue, sarees and menswear.
        known = {
            "Real Gold Zari", "Silver Zari", "Silver and Gold Zari", "Antique Zari",
            "Minimal Zari", "Fine Zari Border", "Gold Zari", "Gold Border",
            "Minimal Border", "Self Weave", "Antique Thread Work", "Thread Embroidery",
        }
        self.assertEqual(known - set(backfill.ZARI_MAP), set())

    def test_unmapped_value_is_preserved_as_non_filterable(self):
        from catalog.models import AttributeOption
        from catalog.migrations import _attribute_backfill as backfill

        option = backfill.resolve_or_park(AttributeOption, "fabric", "Moonlight Tissue Silk")
        self.assertFalse(option.is_filterable)
        self.assertIn("needs-review", option.label)

    def test_variant_serializer_still_exposes_fabric_and_zari_strings(self):
        from catalog.models import AttributeOption, Category, Product, ProductVariant
        from catalog.serializers import ProductVariantSerializer

        category = Category.objects.create(name="Kanjivaram", slug="kanjivaram-x", gender="women")
        product = Product.objects.create(
            name="Test Saree", slug="test-saree", category=category, gender="women",
            base_price=100, base_mrp=200,
            fabric=AttributeOption.objects.get(key="fabric", value_slug="kanjivaram-silk"),
            zari=AttributeOption.objects.get(key="zari", value_slug="real-gold-zari"),
        )
        variant = ProductVariant.objects.create(product=product, sku="TS-1", price=100, mrp=200, stock_qty=1)
        data = ProductVariantSerializer(variant).data
        self.assertEqual(data["fabric"], "Kanjivaram Silk")
        self.assertEqual(data["zari_type"], "Real Gold Zari")

    def test_product_with_no_attributes_serializes_blank_not_null(self):
        from catalog.models import Category, Product, ProductVariant
        from catalog.serializers import ProductVariantSerializer

        category = Category.objects.create(name="Plain", slug="plain-x", gender="women")
        product = Product.objects.create(
            name="Bare", slug="bare", category=category, gender="women", base_price=1, base_mrp=1
        )
        variant = ProductVariant.objects.create(product=product, sku="BARE-1", price=1, mrp=1, stock_qty=1)
        data = ProductVariantSerializer(variant).data
        self.assertEqual(data["fabric"], "")
        self.assertEqual(data["zari_type"], "")
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && SECURE_SSL_REDIRECT=false ../.venv/bin/python manage.py test catalog.tests.SareeAttributeBackfillTests
```
Expected: FAIL — `ModuleNotFoundError: catalog.migrations._attribute_backfill`.

- [ ] **Step 3: Add the model fields**

In `backend/catalog/models.py`, add to `Product` (after `occasions`):

```python
    # Saree design attributes. Properties of the design, not the colourway, so they
    # live on Product rather than ProductVariant. PROTECT: retiring an option that
    # products still point at must fail loudly, not orphan them.
    fabric = models.ForeignKey(
        "AttributeOption", null=True, blank=True, on_delete=models.PROTECT,
        related_name="products_fabric", limit_choices_to={"key": "fabric"},
    )
    weave = models.ForeignKey(
        "AttributeOption", null=True, blank=True, on_delete=models.PROTECT,
        related_name="products_weave", limit_choices_to={"key": "weave"},
    )
    zari = models.ForeignKey(
        "AttributeOption", null=True, blank=True, on_delete=models.PROTECT,
        related_name="products_zari", limit_choices_to={"key": "zari"},
    )
    border = models.ForeignKey(
        "AttributeOption", null=True, blank=True, on_delete=models.PROTECT,
        related_name="products_border", limit_choices_to={"key": "border"},
    )
    pallu = models.ForeignKey(
        "AttributeOption", null=True, blank=True, on_delete=models.PROTECT,
        related_name="products_pallu", limit_choices_to={"key": "pallu"},
    )
    work = models.ForeignKey(
        "AttributeOption", null=True, blank=True, on_delete=models.PROTECT,
        related_name="products_work", limit_choices_to={"key": "work"},
    )
    origin = models.ForeignKey(
        "AttributeOption", null=True, blank=True, on_delete=models.PROTECT,
        related_name="products_origin", limit_choices_to={"key": "origin"},
    )
    silk_mark_certified = models.BooleanField(default=False)
```

Add to `ProductVariant` (after `length_meters`):

```python
    blouse_length_meters = models.DecimalField(max_digits=4, decimal_places=2, null=True, blank=True)
    weight_grams = models.PositiveIntegerField(null=True, blank=True)
```

Do NOT remove `fabric` / `zari_type` from `ProductVariant` yet — the backfill in Step 5 reads them.

- [ ] **Step 4: Generate the add-fields migration**

```bash
cd backend && SECURE_SSL_REDIRECT=false ../.venv/bin/python manage.py makemigrations catalog
```
Expected: creates `0006_*.py` adding the eight product fields and two variant fields.

- [ ] **Step 5: Write the backfill module and migration**

Create `backend/catalog/migrations/_attribute_backfill.py` (a plain module, not a migration — so the mapping tables are importable and testable):

```python
"""Mapping tables for the free-text -> AttributeOption backfill.

Kept in a plain module rather than inline in the migration so the tables are
unit-testable. Every value below was read out of the live catalogue; nothing here
is invented. Unknown strings are parked, never dropped or guessed.
"""

from django.utils.text import slugify

FABRIC_MAP = {
    "Pure Kanjivaram Silk": "kanjivaram-silk",
    "Kanjivaram Silk": "kanjivaram-silk",
    "Banarasi Silk": "banarasi-silk",
    "Pure Patola Silk": "patola-silk",
    "Mysore Crepe Silk": "mysore-crepe-silk",
    "Tussar Silk": "tussar-silk",
    "Soft Silk": "soft-silk",
    "Silk Cotton": "silk-cotton",
    "Dupion Silk": "dupion-silk",
    "Raw Silk": "raw-silk",
    "Silk Blend": "silk-blend",
    "Pure Silk": "pure-silk",
}

# value -> (zari_slug or None, border_slug or None)
# The zari_type column was absorbing three concepts; this table separates zari from
# border, and WORK_MAP below pulls out the third. A value can map to none of them
# (e.g. "Self Weave" is purely a work type).
ZARI_MAP = {
    "Real Gold Zari": ("real-gold-zari", None),
    "Gold Zari": ("gold-zari", None),
    "Silver Zari": ("silver-zari", None),
    "Silver and Gold Zari": ("gold-silver-zari", None),
    "Antique Zari": ("antique-zari", None),
    "Minimal Zari": ("minimal-zari", None),
    "Fine Zari Border": ("gold-zari", "zari-border"),
    "Gold Border": ("gold-zari", "zari-border"),
    "Minimal Border": ("minimal-zari", "minimal-border"),
    "Self Weave": (None, None),
    "Antique Thread Work": ("antique-zari", None),
    "Thread Embroidery": (None, None),
}

# Values whose real meaning is a *work* type rather than a zari or border.
WORK_MAP = {
    "Self Weave": "woven",
    "Antique Thread Work": "thread-work",
    "Thread Embroidery": "embroidery",
}


def resolve_or_park(AttributeOption, key: str, raw_value: str):
    """Return the AttributeOption for `raw_value`, parking unknowns for review.

    A parked option is inactive as a filter but keeps the product's data intact,
    so nothing is lost and a merchandiser can see exactly what needs attention.
    """
    raw_value = (raw_value or "").strip()
    if not raw_value:
        return None
    table = {"fabric": FABRIC_MAP}.get(key, {})
    slug = table.get(raw_value)
    if slug:
        existing = AttributeOption.objects.filter(key=key, value_slug=slug).first()
        if existing:
            return existing
    parked_slug = slugify(raw_value)[:80] or "unknown"
    option, _ = AttributeOption.objects.get_or_create(
        key=key,
        value_slug=parked_slug,
        defaults={"label": f"{raw_value} (needs-review)", "is_filterable": False, "sort_order": 9000},
    )
    return option
```

Create `backend/catalog/migrations/0007_backfill_attributes.py`:

```python
from django.db import migrations

from ._attribute_backfill import WORK_MAP, ZARI_MAP, resolve_or_park


def backfill(apps, schema_editor):
    AttributeOption = apps.get_model("catalog", "AttributeOption")
    ProductVariant = apps.get_model("catalog", "ProductVariant")
    parked = []

    for variant in ProductVariant.objects.select_related("product").all():
        product = variant.product
        changed = []

        if variant.fabric and product.fabric_id is None:
            option = resolve_or_park(AttributeOption, "fabric", variant.fabric)
            if option:
                product.fabric_id = option.id
                changed.append("fabric_id")
                if not option.is_filterable:
                    parked.append(f"fabric={variant.fabric!r} (product {product.slug})")

        raw_zari = (variant.zari_type or "").strip()
        if raw_zari:
            zari_slug, border_slug = ZARI_MAP.get(raw_zari, (None, None))
            if zari_slug and product.zari_id is None:
                option = AttributeOption.objects.filter(key="zari", value_slug=zari_slug).first()
                if option:
                    product.zari_id = option.id
                    changed.append("zari_id")
            if border_slug and product.border_id is None:
                option = AttributeOption.objects.filter(key="border", value_slug=border_slug).first()
                if option:
                    product.border_id = option.id
                    changed.append("border_id")
            work_slug = WORK_MAP.get(raw_zari)
            if work_slug and product.work_id is None:
                option = AttributeOption.objects.filter(key="work", value_slug=work_slug).first()
                if option:
                    product.work_id = option.id
                    changed.append("work_id")
            if raw_zari not in ZARI_MAP:
                option = resolve_or_park(AttributeOption, "zari", raw_zari)
                if option and product.zari_id is None:
                    product.zari_id = option.id
                    changed.append("zari_id")
                parked.append(f"zari={raw_zari!r} (product {product.slug})")

        if changed:
            product.save(update_fields=list(dict.fromkeys(changed)))

    # weave / pallu / origin / silk_mark_certified are deliberately left null:
    # they are not recoverable from Product.specifications, whose "Origin" key holds
    # the boilerplate "Kanchipuram curated collection" on every product including the
    # Banarasi, Patola, Mysore and Tussar sarees. Backfilling it would publish a false
    # provenance claim. A merchandiser sets these in admin.
    if parked:
        print("\n[backfill] values parked for review:")
        for line in parked:
            print(f"  - {line}")


def noop_reverse(apps, schema_editor):
    """Reversing drops the FK values; the source strings still exist until 0008."""
    Product = apps.get_model("catalog", "Product")
    Product.objects.update(fabric=None, zari=None, border=None, work=None)


class Migration(migrations.Migration):
    dependencies = [("catalog", "0006_product_attributes")]
    operations = [migrations.RunPython(backfill, noop_reverse)]
```

If Step 4 named the migration something other than `0006_product_attributes`, fix `dependencies` and rename the file's number to stay sequential.

- [ ] **Step 6: Update the variant serializer to read through**

In `backend/catalog/serializers.py`, change `ProductVariantSerializer` (around line 25) so `fabric` and `zari_type` become read-only method fields sourced from the product:

```python
class ProductVariantSerializer(serializers.ModelSerializer):
    # Kept as string keys for API compatibility — every existing client (PDP, admin
    # list, mobile) reads variant.fabric. The values now come from the product's
    # controlled attributes, so there is one source of truth, not two.
    fabric = serializers.SerializerMethodField()
    zari_type = serializers.SerializerMethodField()

    def get_fabric(self, obj) -> str:
        return obj.product.fabric.label if obj.product.fabric_id else ""

    def get_zari_type(self, obj) -> str:
        return obj.product.zari.label if obj.product.zari_id else ""
```

Add `"blouse_length_meters"` and `"weight_grams"` to that serializer's `Meta.fields` list, next to `"length_meters"`.

- [ ] **Step 7: Keep the variant prefetch from N+1'ing**

In `backend/catalog/selectors.py`, the `Prefetch("variants", ...)` inside `product_base_queryset` must pull the product's attribute rows, or `get_fabric` fires a query per variant:

```python
def product_base_queryset() -> QuerySet[Product]:
    return (
        Product.objects.select_related("category", "fabric", "weave", "zari", "border", "pallu", "work", "origin")
        .prefetch_related(
            Prefetch(
                "variants",
                queryset=ProductVariant.objects.select_related("product__fabric", "product__zari").order_by("id"),
            ),
            Prefetch("images", queryset=ProductImage.objects.order_by("sort_order", "id")),
            "collections",
        )
    )
```

- [ ] **Step 8: Update the quick-create write path**

In `backend/catalog/serializers.py::AdminProductQuickCreateSerializer.create` (around line 438), the `ProductVariant.objects.create(...)` call passes `fabric=fabric` and `zari_type=...`. Remove both kwargs — the columns are going away. Leave the incoming `fabric` / `zari_type` serializer fields in place for now (Task 5 converts them to controlled choices); they still feed `tags`, `key_highlights` and `specifications` exactly as before.

- [ ] **Step 9: Update the seeder**

In `backend/catalog/management/commands/seed_csm.py`, the variant payload at line ~425 sets `"zari_type": pdata["zari"]` and a `fabric` key. Remove both from the variant payload and set the product's FKs instead, resolving through the same mapping tables:

```python
from catalog.migrations._attribute_backfill import FABRIC_MAP, ZARI_MAP
from catalog.models import AttributeOption

def _option(key: str, slug: str | None):
    if not slug:
        return None
    return AttributeOption.objects.filter(key=key, value_slug=slug).first()

# where the Product is created/updated:
fabric_option = _option("fabric", FABRIC_MAP.get(pdata["fabric"]))
zari_slug, border_slug = ZARI_MAP.get(pdata["zari"], (None, None))
product.fabric = fabric_option
product.zari = _option("zari", zari_slug)
product.border = _option("border", border_slug)
product.save(update_fields=["fabric", "zari", "border"])
```

Match the surrounding code's create-or-update idiom rather than pasting this verbatim; what matters is that the seeder stops writing the dropped columns and starts setting the FKs.

- [ ] **Step 10: Fix the existing tests that set the dropped columns**

`CatalogFacetCountTests.setUp` in `backend/catalog/tests.py` passes `fabric="Pure silk"` and `fabric="Mysore silk"` to `ProductVariant.objects.create(...)`. Move those onto the products as FKs, creating the options in `setUp`:

```python
        self.pure_silk = AttributeOption.objects.create(key="fabric", value_slug="pure-silk-test", label="Pure silk")
        self.mysore = AttributeOption.objects.create(key="fabric", value_slug="mysore-silk-test", label="Mysore silk")
```
Set `fabric=self.pure_silk` on `self.ruby` and `fabric=self.mysore` on `self.emerald` at `Product.objects.create(...)`, and drop the `fabric=` kwarg from both `ProductVariant.objects.create(...)` calls. The assertions in `test_facets_include_counts` (which expect `fabric_counts == {"Pure silk": 1, "Mysore silk": 1}`) must keep passing — Task 4 rewrites how those counts are derived; for now make the fixture change and let the existing facet query in `views.py` be updated in Step 11.

- [ ] **Step 11: Point the existing facet and search queries at the new column**

`backend/catalog/views.py::CatalogFacetsView` aggregates `variants.exclude(fabric="").values("fabric")`. Change it to aggregate over products:

```python
        fabric_counts = (
            products.exclude(fabric__isnull=True)
            .order_by()
            .values("fabric__label")
            .annotate(count=Count("id", distinct=True))
            .order_by("fabric__label")
        )
```
and update the two response entries that read `row["fabric"]` to read `row["fabric__label"]`.

`backend/catalog/selectors.py` has two references to the dropped column — line ~59 `Q(variants__fabric__icontains=search)` in the search branch and line ~73 `fabric_q |= Q(variants__fabric__icontains=value)`. Change both to `fabric__label__icontains`.

- [ ] **Step 12: Drop the columns**

Remove `fabric` and `zari_type` from `ProductVariant` in `backend/catalog/models.py`, then:

```bash
cd backend && SECURE_SSL_REDIRECT=false ../.venv/bin/python manage.py makemigrations catalog
```
Expected: creates `0008_*.py` with two `RemoveField` operations.

- [ ] **Step 13: Run the full catalog suite**

```bash
cd backend && SECURE_SSL_REDIRECT=false ../.venv/bin/python manage.py test catalog
```
Expected: PASS — `SareeAttributeBackfillTests` 6/6 and every pre-existing catalog test still green.

- [ ] **Step 14: Verify the backfill against the real dev database**

```bash
cd backend && SECURE_SSL_REDIRECT=false ../.venv/bin/python manage.py migrate catalog
cd backend && SECURE_SSL_REDIRECT=false ../.venv/bin/python -c "
import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE','csm_backend.settings')
django.setup()
from catalog.models import Product
for p in Product.objects.filter(gender='women'):
    print(p.slug, '|', p.fabric and p.fabric.label, '|', p.zari and p.zari.label, '|', p.border and p.border.label)
" 2>&1 | grep -v '^DEBUG\|^INFO'
```
Expected: all 8 sarees have a fabric; **both** Kanjivaram products and `temple-border-kanjivaram` show `Kanjivaram Silk` (three products, one option — the collapse); `mysore-crepe-silk-emerald` shows zari `Gold Zari` AND border `Zari Border` (the split). Report the actual output in your task report.

- [ ] **Step 15: Confirm no migration drift and commit**

```bash
cd backend && SECURE_SSL_REDIRECT=false ../.venv/bin/python manage.py makemigrations --check --dry-run
git add backend/catalog/models.py backend/catalog/migrations/ backend/catalog/serializers.py backend/catalog/selectors.py backend/catalog/views.py backend/catalog/tests.py backend/catalog/management/commands/seed_csm.py
git commit -m "feat(catalog): move fabric/zari to controlled Product attributes, backfill and drop variant columns"
```

---

### Task 3: Filter products by the new attributes

**Files:**
- Modify: `backend/catalog/selectors.py::public_products`
- Test: `backend/catalog/tests.py` (append `SareeAttributeFilterTests`)

**Interfaces:**
- Consumes: `Product.fabric` … `Product.origin` from Task 2; `_split_multi` already in `selectors.py`.
- Produces: `public_products` accepts params `fabric`, `weave`, `zari`, `border`, `pallu`, `work`, `origin`, each comma-separated multi-value matched on `value_slug`; `fabric` additionally matches `label` case-insensitively for back-compat. Module constant `ATTRIBUTE_PARAMS: tuple[str, ...]` — Task 4 imports it.

- [ ] **Step 1: Write the failing test**

```python
class SareeAttributeFilterTests(TestCase):
    def setUp(self):
        from catalog.models import AttributeOption, Category, Product, ProductVariant

        self.client = APIClient()
        category = Category.objects.create(name="Kanjivaram", slug="kanjivaram", gender="women", product_type="saree")
        kanjivaram = AttributeOption.objects.get(key="fabric", value_slug="kanjivaram-silk")
        patola = AttributeOption.objects.get(key="fabric", value_slug="patola-silk")
        gold = AttributeOption.objects.get(key="zari", value_slug="real-gold-zari")
        silver = AttributeOption.objects.get(key="zari", value_slug="silver-zari")

        for slug, fabric, zari in [
            ("a", kanjivaram, gold),
            ("b", kanjivaram, silver),
            ("c", patola, gold),
        ]:
            product = Product.objects.create(
                name=slug.upper(), slug=slug, category=category, gender="women",
                base_price=100, base_mrp=200, fabric=fabric, zari=zari,
            )
            ProductVariant.objects.create(product=product, sku=f"SKU-{slug}", price=100, mrp=200, stock_qty=3)

    def test_single_attribute_filters(self):
        response = self.client.get("/api/products", {"gender": "women", "fabric": "kanjivaram-silk"})
        self.assertEqual(response.json()["total"], 2)

    def test_multi_value_within_a_group_is_a_union(self):
        response = self.client.get("/api/products", {"gender": "women", "fabric": "kanjivaram-silk,patola-silk"})
        self.assertEqual(response.json()["total"], 3)

    def test_across_groups_is_an_intersection(self):
        response = self.client.get(
            "/api/products", {"gender": "women", "fabric": "kanjivaram-silk", "zari": "silver-zari"}
        )
        self.assertEqual(response.json()["total"], 1)

    def test_legacy_label_form_still_filters(self):
        response = self.client.get("/api/products", {"gender": "women", "fabric": "Kanjivaram Silk"})
        self.assertEqual(response.json()["total"], 2)

    def test_unknown_slug_is_ignored_not_an_error(self):
        # Shareable links must not rot when a merchandiser retires an option.
        response = self.client.get("/api/products", {"gender": "women", "zari": "retired-option"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total"], 0)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && SECURE_SSL_REDIRECT=false ../.venv/bin/python manage.py test catalog.tests.SareeAttributeFilterTests
```
Expected: FAIL — `test_across_groups_is_an_intersection` returns 2 (the `zari` param is ignored today).

- [ ] **Step 3: Implement the filters**

In `backend/catalog/selectors.py`, add the constant near `_split_multi`:

```python
# Attribute params accepted on /api/products, matched against AttributeOption.value_slug.
# `fabric` is listed first because it also accepts the human label for back-compat.
ATTRIBUTE_PARAMS = ("fabric", "weave", "zari", "border", "pallu", "work", "origin")
```

Replace the existing `if fabric:` block in `public_products` with a loop over all seven, placed where the old fabric block was:

```python
    for attribute in ATTRIBUTE_PARAMS:
        values = _split_multi(params.get(attribute))
        if not values:
            continue
        attribute_q = Q()
        for value in values:
            attribute_q |= Q(**{f"{attribute}__value_slug__iexact": value})
            if attribute == "fabric":
                # Links minted before the controlled vocabulary carry the label.
                attribute_q |= Q(fabric__label__iexact=value)
        qs = qs.filter(attribute_q)
```

Delete the now-dead `fabric = params.get("fabric")` local and the old `fabric_q` block.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && SECURE_SSL_REDIRECT=false ../.venv/bin/python manage.py test catalog
```
Expected: PASS — `SareeAttributeFilterTests` 5/5, whole catalog suite green.

- [ ] **Step 5: Commit**

```bash
git add backend/catalog/selectors.py backend/catalog/tests.py
git commit -m "feat(catalog): filter products by controlled saree attributes"
```

---

### Task 4: Facet `attributes` block with own-filter-excluded counts

**Files:**
- Modify: `backend/catalog/views.py::CatalogFacetsView`
- Test: `backend/catalog/tests.py` (append `SareeFacetAttributeTests`)

**Interfaces:**
- Consumes: `ATTRIBUTE_PARAMS` and `public_products` from Task 3; `Category.product_type` from Task 1.
- Produces: `/api/catalog/facets` response key `attributes`: a list of `{"key": str, "label": str, "options": [{"slug": str, "label": str, "count": int}]}`. Absent (empty list) for non-saree scopes. The frontend `CatalogFacets` type in Task 6 mirrors this exactly.

- [ ] **Step 1: Write the failing test**

```python
class SareeFacetAttributeTests(TestCase):
    def setUp(self):
        from catalog.models import AttributeOption, Category, Product, ProductVariant

        self.client = APIClient()
        self.saree_cat = Category.objects.create(
            name="Kanjivaram", slug="kanjivaram", gender="women", product_type="saree"
        )
        self.mens_cat = Category.objects.create(
            name="Dhoti", slug="mens-dhoti", gender="men", product_type="menswear"
        )
        kanjivaram = AttributeOption.objects.get(key="fabric", value_slug="kanjivaram-silk")
        patola = AttributeOption.objects.get(key="fabric", value_slug="patola-silk")
        gold = AttributeOption.objects.get(key="zari", value_slug="real-gold-zari")

        for slug, fabric, zari, category, gender in [
            ("a", kanjivaram, gold, self.saree_cat, "women"),
            ("b", kanjivaram, gold, self.saree_cat, "women"),
            ("c", patola, gold, self.saree_cat, "women"),
            ("d", None, None, self.mens_cat, "men"),
        ]:
            product = Product.objects.create(
                name=slug.upper(), slug=slug, category=category, gender=gender,
                base_price=100, base_mrp=200, fabric=fabric, zari=zari,
            )
            ProductVariant.objects.create(product=product, sku=f"SKU-{slug}", price=100, mrp=200, stock_qty=3)

    def _groups(self, params):
        data = self.client.get("/api/catalog/facets", params).json()
        return {group["key"]: group for group in data.get("attributes", [])}

    def test_saree_scope_returns_attribute_groups_with_counts(self):
        groups = self._groups({"gender": "women"})
        self.assertIn("fabric", groups)
        counts = {option["slug"]: option["count"] for option in groups["fabric"]["options"]}
        self.assertEqual(counts, {"kanjivaram-silk": 2, "patola-silk": 1})

    def test_group_with_fewer_than_two_options_is_omitted(self):
        # Every saree here has the same zari, so a Zari group would be a single
        # useless checkbox.
        groups = self._groups({"gender": "women"})
        self.assertNotIn("zari", groups)

    def test_counts_exclude_the_groups_own_filter(self):
        # Ticking one fabric must not zero out the others, or multi-select is unusable.
        groups = self._groups({"gender": "women", "fabric": "kanjivaram-silk"})
        counts = {option["slug"]: option["count"] for option in groups["fabric"]["options"]}
        self.assertEqual(counts, {"kanjivaram-silk": 2, "patola-silk": 1})

    def test_other_groups_still_respect_the_active_filter(self):
        from catalog.models import AttributeOption, Product

        silver = AttributeOption.objects.get(key="zari", value_slug="silver-zari")
        Product.objects.filter(slug="c").update(zari=silver)
        groups = self._groups({"gender": "women", "fabric": "kanjivaram-silk"})
        counts = {option["slug"]: option["count"] for option in groups.get("zari", {"options": []})["options"]}
        self.assertNotIn("silver-zari", counts)

    def test_menswear_scope_returns_no_attribute_groups(self):
        self.assertEqual(self._groups({"gender": "men"}), {})

    def test_legacy_facet_fields_are_unchanged(self):
        data = self.client.get("/api/catalog/facets", {"gender": "women"}).json()
        for key in ("categories", "colors", "fabrics", "occasions", "price", "sorts", "total",
                    "category_counts", "fabric_counts", "occasion_counts"):
            self.assertIn(key, data)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && SECURE_SSL_REDIRECT=false ../.venv/bin/python manage.py test catalog.tests.SareeFacetAttributeTests
```
Expected: FAIL — no `attributes` key in the response.

- [ ] **Step 3: Implement the attributes block**

In `backend/catalog/views.py`, import what you need and add two helpers above `CatalogFacetsView`:

```python
from .models import AttributeOption
from .selectors import ATTRIBUTE_PARAMS, public_products


def _is_saree_scope(params) -> bool:
    """Which attribute panel applies — a property of the catalogue, not the URL."""
    category = params.get("category")
    if category:
        return Category.objects.filter(slug=category, product_type=Category.ProductType.SAREE).exists()
    return (params.get("gender") or "") == "women"


def _attribute_groups(params) -> list[dict]:
    if not _is_saree_scope(params):
        return []
    labels = dict(AttributeOption.Key.choices)
    groups = []
    for key in ATTRIBUTE_PARAMS:
        # Count over the queryset with THIS group's own filter removed, so ticking
        # one option does not zero out its siblings. Other filters still apply.
        trimmed = params.copy()
        trimmed.pop(key, None)
        rows = (
            public_products(trimmed)
            .filter(**{f"{key}__is_filterable": True, f"{key}__is_active": True})
            .order_by()
            .values(f"{key}__value_slug", f"{key}__label", f"{key}__sort_order")
            .annotate(count=Count("id", distinct=True))
        )
        options = sorted(
            (
                {
                    "slug": row[f"{key}__value_slug"],
                    "label": row[f"{key}__label"],
                    "count": row["count"],
                    "_sort": row[f"{key}__sort_order"],
                }
                for row in rows
                if row["count"]
            ),
            key=lambda option: (option["_sort"], option["label"]),
        )
        for option in options:
            option.pop("_sort")
        # A single-option group is a checkbox that filters nothing. Hide it.
        if len(options) < 2:
            continue
        groups.append({"key": key, "label": labels[key], "options": options})
    return groups
```

Then add one line to the `Response({...})` dict in `CatalogFacetsView.get`:

```python
                "attributes": _attribute_groups(request.query_params),
```

`request.query_params` is a `QueryDict`; `.copy()` returns a mutable copy, so `.pop()` is safe and the original is untouched.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && SECURE_SSL_REDIRECT=false ../.venv/bin/python manage.py test catalog
```
Expected: PASS — `SareeFacetAttributeTests` 6/6, whole catalog suite green (including the pre-existing `CatalogFacetCountTests`, whose legacy count semantics this task does not touch).

- [ ] **Step 5: Commit**

```bash
git add backend/catalog/views.py backend/catalog/tests.py
git commit -m "feat(catalog): expose saree attribute facets with own-filter-excluded counts"
```

---

### Task 5: Admin — option management and controlled quick-create

**Files:**
- Modify: `backend/catalog/serializers.py` (`AdminProductWriteSerializer` fields; `AdminAttributeOptionSerializer`; quick-create validation)
- Modify: `backend/catalog/views.py` (add `AdminAttributeOptionViewSet` or an APIView pair, matching the file's existing admin-view idiom)
- Modify: `backend/catalog/urls.py` (route `admin/attribute-options`)
- Test: `backend/catalog/tests.py` (append `AdminAttributeOptionTests`)

**Interfaces:**
- Consumes: `AttributeOption` (Task 1), `Product` FKs (Task 2).
- Produces: `GET/POST /api/admin/attribute-options` and `PATCH/DELETE /api/admin/attribute-options/<id>`, staff-only. `AdminProductWriteSerializer` accepts the seven FK ids plus `silk_mark_certified`.

- [ ] **Step 1: Write the failing test**

```python
class AdminAttributeOptionTests(TestCase):
    def setUp(self):
        from accounts.models import User

        self.client = APIClient()
        self.staff = User.objects.create_user(email="staff@csm.test", password="pw12345!", is_staff=True)

    def test_listing_options_requires_staff(self):
        response = self.client.get("/api/admin/attribute-options")
        self.assertIn(response.status_code, (401, 403))

    def test_staff_can_list_and_filter_by_key(self):
        self.client.force_authenticate(self.staff)
        response = self.client.get("/api/admin/attribute-options", {"key": "zari"})
        self.assertEqual(response.status_code, 200)
        keys = {row["key"] for row in response.json()}
        self.assertEqual(keys, {"zari"})

    def test_staff_can_create_a_new_option(self):
        self.client.force_authenticate(self.staff)
        response = self.client.post(
            "/api/admin/attribute-options",
            {"key": "fabric", "value_slug": "tissue-silk", "label": "Tissue Silk"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)

    def test_quick_create_rejects_an_unknown_fabric(self):
        # Quick-create is where "Pure Kanjivaram Silk" got typed by hand. Close the leak.
        self.client.force_authenticate(self.staff)
        response = self.client.post(
            "/api/admin/products/quick-create",
            {"name": "X", "category": "kanjivaram", "price": "100", "mrp": "200", "fabric": "Invented Silk"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("fabric", response.json())

    def test_quick_create_accepts_a_known_fabric_slug(self):
        from catalog.models import Category, Product

        Category.objects.create(name="Kanjivaram", slug="kanjivaram", gender="women", product_type="saree")
        self.client.force_authenticate(self.staff)
        response = self.client.post(
            "/api/admin/products/quick-create",
            {"name": "X", "category": "kanjivaram", "price": "100", "mrp": "200", "fabric": "kanjivaram-silk"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Product.objects.get(name="X").fabric.value_slug, "kanjivaram-silk")
```

The quick-create route is confirmed: `admin/products/quick-create` (`backend/catalog/urls.py:31`). Read the existing `AdminCatalogCrudTests` (`backend/catalog/tests.py:106`) first and match its authentication idiom and the quick-create payload's actual required fields — `AdminProductQuickCreateSerializer` (`backend/catalog/serializers.py:300`) is the authority on which fields are mandatory. Adjust the test to the real API, not the other way round.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && SECURE_SSL_REDIRECT=false ../.venv/bin/python manage.py test catalog.tests.AdminAttributeOptionTests
```
Expected: FAIL — 404 on `/api/admin/attribute-options`.

- [ ] **Step 3: Add the serializer**

In `backend/catalog/serializers.py`:

```python
class AdminAttributeOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = AttributeOption
        fields = ["id", "key", "value_slug", "label", "sort_order", "is_filterable", "is_active"]
```

Add the seven FK names and `silk_mark_certified` to `AdminProductWriteSerializer.Meta.fields` (after `"occasions"`):

```python
            "fabric",
            "weave",
            "zari",
            "border",
            "pallu",
            "work",
            "origin",
            "silk_mark_certified",
```

- [ ] **Step 4: Constrain quick-create**

In `AdminProductQuickCreateSerializer`, add a validator that rejects free text. Add these methods to the class:

```python
    def _resolve_option(self, key: str, value: str):
        value = (value or "").strip()
        if not value:
            return None
        option = AttributeOption.objects.filter(
            key=key, is_active=True
        ).filter(Q(value_slug__iexact=value) | Q(label__iexact=value)).first()
        if option is None:
            raise serializers.ValidationError(
                {key: f"Unknown {key}. Add it under Admin > Attribute options first, then retry."}
            )
        return option

    def validate_fabric(self, value):
        self._resolve_option("fabric", value)
        return value

    def validate_zari_type(self, value):
        self._resolve_option("zari", value)
        return value
```

In `create()`, set the product's FKs from the resolved options (the `Product.objects.create(...)` call gains `fabric=` and `zari=` kwargs). Keep the existing `tags` / `key_highlights` / `specifications` behaviour, but use the resolved option's `label` rather than the raw input so the derived text is canonical too.

- [ ] **Step 5: Add the view and route**

Add an admin view for `AttributeOption` in `backend/catalog/views.py`, following the permission and pagination idiom of the existing admin views in that file (read them first — do not invent a new pattern). It must support: list filtered by `?key=`, create, patch, delete. Register it in `backend/catalog/urls.py` at `admin/attribute-options` and `admin/attribute-options/<int:pk>`.

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd backend && SECURE_SSL_REDIRECT=false ../.venv/bin/python manage.py test catalog
```
Expected: PASS — `AdminAttributeOptionTests` 5/5, whole catalog suite green.

- [ ] **Step 7: Commit**

```bash
git add backend/catalog/serializers.py backend/catalog/views.py backend/catalog/urls.py backend/catalog/tests.py
git commit -m "feat(catalog): admin CRUD for attribute options, controlled quick-create"
```

---

### Task 6: Frontend types and filter state

**Files:**
- Modify: `frontend/src/types/index.ts:416-427` (`CatalogFacets`)
- Modify: `frontend/src/features/catalog/plpFilters.ts`
- Test: `frontend/src/features/catalog/plpFilters.test.ts`

**Interfaces:**
- Consumes: the `attributes` response shape from Task 4.
- Produces: `PlpFilterState.attributes: Record<string, string[]>`; exported `ATTRIBUTE_KEYS` (readonly tuple `['fabric','weave','zari','border','pallu','work','origin']`); `PlpFilterState.fabrics` is **removed** — Task 7 must read `state.attributes.fabric` instead. `CatalogFacets.attributes?: CatalogAttributeGroup[]` with `interface CatalogAttributeGroup { key: string; label: string; options: Array<{ slug: string; label: string; count: number }> }`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/features/catalog/plpFilters.test.ts`:

```ts
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

  it('ignores unknown attribute keys', () => {
    expect(parsePlpParams(new URLSearchParams('bogus=x')).attributes).toEqual({});
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
```

Read the existing tests in that file first and match their import list and the `PlpChip` shape `activePlpChips` already returns (`frontend/src/features/catalog/plpFilters.ts:114`).

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/features/catalog/plpFilters.test.ts
```
Expected: FAIL — `attributes` is undefined on the state.

- [ ] **Step 3: Update the types**

In `frontend/src/types/index.ts`, add above `CatalogFacets`:

```ts
export interface CatalogAttributeOption {
  slug: string;
  label: string;
  count: number;
}

export interface CatalogAttributeGroup {
  key: string;
  label: string;
  options: CatalogAttributeOption[];
}
```
and add `attributes?: CatalogAttributeGroup[];` to `CatalogFacets`.

- [ ] **Step 4: Update the filter state**

In `frontend/src/features/catalog/plpFilters.ts`:

```ts
// Must match ATTRIBUTE_PARAMS in backend/catalog/selectors.py.
export const ATTRIBUTE_KEYS = ['fabric', 'weave', 'zari', 'border', 'pallu', 'work', 'origin'] as const;
export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];
```

Replace `fabrics: string[]` in `PlpFilterState` with `attributes: Record<string, string[]>`, and `fabrics: []` in `DEFAULT_PLP_STATE` with `attributes: {}`.

In `parsePlpParams`, drop the `fabrics` line and add:

```ts
  const attributes: Record<string, string[]> = {};
  for (const key of ATTRIBUTE_KEYS) {
    // ?fabrics= is the pre-vocabulary param name; accept it, re-serialize as ?fabric=.
    const raw = params.get(key) ?? (key === 'fabric' ? params.get('fabrics') : null);
    const values = cleanList(raw);
    if (values.length) attributes[key] = values;
  }
```
and include `attributes` in the returned object.

In `plpStateToParams`, drop the `fabrics` line and add:

```ts
  for (const key of ATTRIBUTE_KEYS) {
    const values = state.attributes[key] || [];
    if (values.length) params.set(key, values.join(','));
  }
```

In `buildProductQuery`, drop `fabric: state.fabrics...` and spread the groups in:

```ts
    ...Object.fromEntries(
      ATTRIBUTE_KEYS.map(key => [key, (state.attributes[key] || []).join(',') || undefined]),
    ),
```

Update `clearedPlpState` to reset `attributes: {}`, and the chip-derivation helper to emit one chip per selected value with key `attr:<group>:<slug>` and a removal that filters that value out of `state.attributes[group]`.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd frontend && npx vitest run src/features/catalog/plpFilters.test.ts
```
Expected: PASS — new block plus all pre-existing tests in the file.

- [ ] **Step 6: Commit**

Note `npm run build` will still fail here because `FilterSidebar.tsx` and `CatalogPlp.tsx` still reference `state.fabrics`; Task 7 fixes that. Commit the state layer on its own:

```bash
git add frontend/src/types/index.ts frontend/src/features/catalog/plpFilters.ts frontend/src/features/catalog/plpFilters.test.ts
git commit -m "feat(plp): model saree attribute filters in URL-synced state"
```

---

### Task 7: Render the attribute groups in the filter sidebar

**Files:**
- Modify: `frontend/src/features/catalog/components/FilterSidebar.tsx`
- Modify: `frontend/src/features/catalog/CatalogPlp.tsx` (only where it reads `state.fabrics`)
- Modify: `frontend/src/features/catalog/components/PlpSortBar.tsx` (only where it renders fabric chips)
- Modify: `frontend/src/styles/plp.css` (add `.plp-filter-more` for the show-all toggle)

**Interfaces:**
- Consumes: `ATTRIBUTE_KEYS`, `PlpFilterState.attributes` (Task 6); `CatalogFacets.attributes` (Task 4).
- Produces: no new exports.

- [ ] **Step 1: Replace the hardcoded Fabric group with a generic loop**

In `FilterSidebar.tsx`, delete the `fabricRows` const and the whole `{fabricRows.length > 0 && (<FilterGroup title="Fabric">…)}` block. In its place render every group the API returned:

```tsx
      {(facets?.attributes || []).map(group => (
        <AttributeGroup key={group.key} group={group} state={state} onChange={onChange} />
      ))}
```

Add the component above `FilterSidebar` — groups over 8 options collapse behind a Show all toggle, so Fabric with 9 silks does not push Occasion off the fold:

```tsx
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
```

Import `CatalogAttributeGroup` from `@/types` alongside `CatalogFacets`.

- [ ] **Step 2: Fix the active-filter count**

In `FilterSidebar`, `activeCount` adds `state.fabrics.length`. Replace that term with every selected attribute value:

```tsx
    Object.values(state.attributes).reduce((total, values) => total + values.length, 0) +
```

- [ ] **Step 3: Add the toggle style**

Append to `frontend/src/styles/plp.css`:

```css
.plp-filter-more {
  background: none;
  border: 0;
  color: var(--gold, #c4923a);
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.2px;
  padding: 6px 0 0;
  text-align: left;
}
.plp-filter-more:hover { text-decoration: underline; }
```

- [ ] **Step 4: Fix the remaining `state.fabrics` references**

```bash
cd frontend && grep -rn "state.fabrics\|\.fabrics" src/features/catalog src/pages
```
Update each hit to read `state.attributes` (chip rendering in `PlpSortBar.tsx`, any reset in `CatalogPlp.tsx`). There must be no `state.fabrics` left.

- [ ] **Step 5: Verify lint, types and tests**

```bash
cd frontend && npm run lint && npm test && npm run build
```
Expected: all three pass. `npm run build` is the real gate here — it runs `tsc -b`, which catches any missed `state.fabrics`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/catalog frontend/src/styles/plp.css
git commit -m "feat(plp): render saree attribute facet groups generically"
```

---

### Task 8: Typed attribute rows on the product detail page

**Files:**
- Modify: `backend/catalog/serializers.py` (`ProductDetailSerializer` gains an `attributes` method field)
- Modify: `frontend/src/types/index.ts` (`Product.attributes`)
- Modify: `frontend/src/pages/ProductDetail.tsx:157-158`
- Test: `backend/catalog/tests.py` (append `ProductDetailAttributeTests`)

**Interfaces:**
- Consumes: `Product` FKs (Task 2).
- Produces: `ProductDetailSerializer` emits `attributes: Array<{key: string; label: string; value: string}>` — typed attributes first, then physical variant specs, omitting anything null.

- [ ] **Step 1: Write the failing test**

```python
class ProductDetailAttributeTests(TestCase):
    def test_detail_lists_typed_attributes_and_omits_nulls(self):
        from catalog.models import AttributeOption, Category, Product, ProductVariant

        client = APIClient()
        category = Category.objects.create(name="Kanjivaram", slug="kanjivaram", gender="women", product_type="saree")
        product = Product.objects.create(
            name="Royal", slug="royal", category=category, gender="women", base_price=100, base_mrp=200,
            fabric=AttributeOption.objects.get(key="fabric", value_slug="kanjivaram-silk"),
            zari=AttributeOption.objects.get(key="zari", value_slug="real-gold-zari"),
            silk_mark_certified=True,
        )
        ProductVariant.objects.create(
            product=product, sku="ROY-1", price=100, mrp=200, stock_qty=2,
            length_meters="6.30", blouse_included=True,
        )
        rows = client.get("/api/products/royal").json()["attributes"]
        by_key = {row["key"]: row["value"] for row in rows}
        self.assertEqual(by_key["fabric"], "Kanjivaram Silk")
        self.assertEqual(by_key["zari"], "Real Gold Zari")
        self.assertEqual(by_key["silk_mark"], "Silk Mark certified")
        self.assertNotIn("weave", by_key)   # null — omitted, not shown blank
        self.assertNotIn("origin", by_key)
        self.assertEqual(by_key["saree_length"], "6.30 m")
```

The detail route is `products/<slug:slug>` (`backend/catalog/urls.py:27`), mounted under `/api`, so `/api/products/royal` is correct as written.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && SECURE_SSL_REDIRECT=false ../.venv/bin/python manage.py test catalog.tests.ProductDetailAttributeTests
```
Expected: FAIL — `KeyError: 'attributes'`.

- [ ] **Step 3: Implement the serializer field**

In `backend/catalog/serializers.py`, add to `ProductDetailSerializer`:

```python
    attributes = serializers.SerializerMethodField()

    def get_attributes(self, obj) -> list[dict]:
        """Typed spec rows for the PDP. Null attributes are omitted rather than
        rendered as blanks — a table of dashes reads as missing data."""
        rows = [
            {"key": key, "label": label, "value": getattr(obj, key).label}
            for key, label in (
                ("fabric", "Fabric"),
                ("weave", "Weave"),
                ("zari", "Zari"),
                ("border", "Border"),
                ("pallu", "Pallu"),
                ("work", "Work"),
                ("origin", "Origin"),
            )
            if getattr(obj, f"{key}_id")
        ]
        if obj.silk_mark_certified:
            rows.append({"key": "silk_mark", "label": "Authenticity", "value": "Silk Mark certified"})
        variant = obj.default_variant
        if variant:
            if variant.length_meters:
                rows.append({"key": "saree_length", "label": "Saree Length", "value": f"{variant.length_meters} m"})
            if variant.blouse_length_meters:
                rows.append({"key": "blouse_length", "label": "Blouse Length", "value": f"{variant.blouse_length_meters} m"})
            rows.append({
                "key": "blouse_piece", "label": "Blouse Piece",
                "value": "Included" if variant.blouse_included else "Not included",
            })
            if variant.weight_grams:
                rows.append({"key": "weight", "label": "Weight", "value": f"{variant.weight_grams} g"})
            if variant.care_instructions:
                rows.append({"key": "care", "label": "Wash Care", "value": variant.care_instructions})
        return rows
```

Add `"attributes"` to `ProductDetailSerializer.Meta.fields`.

- [ ] **Step 4: Run the backend test**

```bash
cd backend && SECURE_SSL_REDIRECT=false ../.venv/bin/python manage.py test catalog
```
Expected: PASS, whole suite green.

- [ ] **Step 5: Render the rows on the PDP**

Add to `Product` in `frontend/src/types/index.ts`:

```ts
  attributes?: Array<{ key: string; label: string; value: string }>;
```

The spec rows live in the `attrs` IIFE at `frontend/src/pages/ProductDetail.tsx:153`. Read it fully
before editing — it has three parts that all need to agree: the gender branch (lines 156-158), a
`rows.push(['Length', ...])`, and a loop pulling `Weight` / `Border` / `Pallu` out of
`specifications`. For sarees, the server now supplies all four, so those two tails must not also run
or every row appears twice. Menswear keeps its current behaviour untouched:

```tsx
  const attrs = (() => {
    const length = activeVariant?.length_meters || p.length_meters;
    const spec = p.specifications || {};

    if (p.gender !== 'men') {
      // Sarees: the server sends typed rows, already including Border, Pallu, Weight
      // and Saree Length. No invented fallbacks — a saree with no recorded zari shows
      // no Zari row rather than a guessed "Gold Zari".
      const rows: Array<[string, string]> = (p.attributes || []).map(
        row => [row.label, row.value] as [string, string],
      );
      if ((p.occasions || []).length) rows.push(['Occasion', (p.occasions || []).join(' / ')]);
      return rows;   // then whatever else the original IIFE returned/appended for both branches
    }

    const rows: Array<[string, string]> = [
      ['Material', activeVariant?.fabric || 'Pure Silk'],
      ['Zari', activeVariant?.zari_type || 'Gold Zari'],
      ['Size', activeVariant?.size || selectedSize || 'S to 5XL'],
      ['Care', activeVariant?.care_instructions || 'Dry Clean Only'],
    ];
    if (length) rows.push(['Length', `${length} m`]);
    for (const key of ['Weight', 'Border', 'Pallu'] as const) {
      if (spec[key]) rows.push([key, spec[key]]);
    }
    // ...keep the remainder of the existing IIFE body verbatim for this branch
  })();
```

Read the rest of the IIFE past line 162 and preserve whatever it does for both branches — the sketch
above only shows the part that changes. Two things must stay true afterwards:

- The invented `'Pure Silk'` / `'Gold Zari'` / `'Bridal / Festive'` fallbacks are gone from the
  **saree** path. They may remain on the menswear path, which this plan does not touch.
- The standalone `specifications` table at `ProductDetail.tsx:476` is left exactly as it is. That
  block already renders the dynamic tail the spec calls for, so do not duplicate it into `attrs`.

- [ ] **Step 6: Verify the frontend**

```bash
cd frontend && npm run lint && npm test && npm run build
```
Expected: all three pass.

- [ ] **Step 7: Commit**

```bash
git add backend/catalog/serializers.py backend/catalog/tests.py frontend/src/types/index.ts frontend/src/pages/ProductDetail.tsx
git commit -m "feat(pdp): render typed saree attribute spec rows"
```

---

## Final verification

After Task 8, run the full gate from a clean shell:

```bash
cd backend && SECURE_SSL_REDIRECT=false ../.venv/bin/python manage.py test accounts catalog cart orders payments inventory loyalty notifications analytics shipping reviews ai csm_backend
cd backend && SECURE_SSL_REDIRECT=false ../.venv/bin/python manage.py makemigrations --check --dry-run
cd frontend && npm run lint && npm test && npm run build
```

The catalog change touches `orders`, `cart` and `inventory` only through `ProductVariant`, so the wider suite is the check that dropping two columns broke nothing downstream.

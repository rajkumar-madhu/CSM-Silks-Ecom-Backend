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

    A parked option carries `is_filterable=False` and nothing else: that flag is the
    whole review signal, so callers building filter UI must honour it. The label stays
    the raw value verbatim because it is shopper-facing — an internal marker like
    "(needs-review)" baked into it would be printed straight onto the product page.
    The migration reports parked values on stdout instead, where operators will see them.
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
        defaults={"label": raw_value, "is_filterable": False, "sort_order": 9000},
    )
    return option


def apply_variant_attributes(AttributeOption, product, raw_fabric: str, raw_zari: str):
    """Fold one variant's free-text attributes into its product, in memory.

    Returns `(changed_fields, parked_notes)` and leaves the save to the caller. That
    split is deliberate: a product's variants must be applied to *one* Product instance
    so the "already set" guards below see what an earlier sibling wrote. Querying
    variants and reading `variant.product` gives a fresh Product object per row (Django
    has no identity map), against which every guard would compare a stale snapshot and
    the last variant would silently overwrite the first.

    First variant to supply a value wins; later ones are ignored rather than clobbering
    it, so a mapped value is never replaced by a parked one.
    """
    changed = []
    parked = []

    raw_fabric = (raw_fabric or "").strip()
    if raw_fabric and product.fabric_id is None:
        option = resolve_or_park(AttributeOption, "fabric", raw_fabric)
        if option:
            product.fabric_id = option.id
            changed.append("fabric_id")
            if not option.is_filterable:
                parked.append(f"fabric={raw_fabric!r} (product {product.slug})")

    raw_zari = (raw_zari or "").strip()
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

    return changed, parked

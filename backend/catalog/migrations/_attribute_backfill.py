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

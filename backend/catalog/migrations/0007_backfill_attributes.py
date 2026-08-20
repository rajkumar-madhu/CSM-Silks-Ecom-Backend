from django.db import migrations
from django.db.models import Prefetch

from ._attribute_backfill import apply_variant_attributes


def backfill(apps, schema_editor):
    AttributeOption = apps.get_model("catalog", "AttributeOption")
    Product = apps.get_model("catalog", "Product")
    ProductVariant = apps.get_model("catalog", "ProductVariant")
    parked = []

    # Iterate products, not variants: every variant of a product must be folded into
    # the same in-memory Product instance, or the "already set" guards in
    # apply_variant_attributes compare against a stale per-row snapshot and the last
    # variant wins. Variants are ordered by id so "first variant wins" is deterministic.
    products = Product.objects.prefetch_related(
        Prefetch("variants", queryset=ProductVariant.objects.order_by("id"))
    )
    for product in products:
        changed = []
        for variant in product.variants.all():
            variant_changed, variant_parked = apply_variant_attributes(
                AttributeOption, product, variant.fabric, variant.zari_type
            )
            changed.extend(variant_changed)
            parked.extend(variant_parked)
        if changed:
            product.save(update_fields=list(dict.fromkeys(changed)))

    # weave / pallu / origin / silk_mark_certified are deliberately left null:
    # they are not recoverable from Product.specifications, whose "Origin" key holds
    # the boilerplate "Kanchipuram curated collection" on every product including the
    # Banarasi, Patola, Mysore and Tussar sarees. Backfilling it would publish a false
    # provenance claim. A merchandiser sets these in admin.
    if parked:
        # Parked options are shopper-safe (label = the raw value) and excluded from
        # filters by is_filterable=False. This log is the operator's needs-review list.
        print("\n[backfill] values parked as needs-review (is_filterable=False):")
        for line in parked:
            print(f"  - {line}")


def noop_reverse(apps, schema_editor):
    """Reversing drops the FK values; the source strings still exist until 0008."""
    Product = apps.get_model("catalog", "Product")
    Product.objects.update(fabric=None, zari=None, border=None, work=None)


class Migration(migrations.Migration):
    dependencies = [("catalog", "0006_product_border_product_fabric_product_origin_and_more")]
    operations = [migrations.RunPython(backfill, noop_reverse)]

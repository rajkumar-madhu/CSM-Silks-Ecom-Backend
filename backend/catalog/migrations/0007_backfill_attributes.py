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
    dependencies = [("catalog", "0006_product_border_product_fabric_product_origin_and_more")]
    operations = [migrations.RunPython(backfill, noop_reverse)]

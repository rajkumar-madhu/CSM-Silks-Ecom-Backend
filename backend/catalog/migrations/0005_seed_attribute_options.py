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
    dependencies = [("catalog", "0004_category_product_type_attributeoption")]
    operations = [migrations.RunPython(seed, unseed)]

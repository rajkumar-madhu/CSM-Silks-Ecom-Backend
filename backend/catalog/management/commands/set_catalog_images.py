"""Replace weak third-party product photos with local premium catalog assets.

Images live on the SPA at /images/catalog/*.jpg (same host as the storefront).
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction

from catalog.models import Product, ProductImage

# product_id -> (primary, secondary hover)
CATALOG_MAP = {
    1: ("royal-kanjivaram.jpg", "royal-kanjivaram-alt.jpg"),
    2: ("temple-kanjivaram.jpg", "royal-kanjivaram.jpg"),
    3: ("banarasi-brocade.jpg", "banarasi-brocade-alt.jpg"),
    4: ("patola-ikat.jpg", "patola-ikat-alt.jpg"),
    5: ("daily-pastel.jpg", "daily-pastel-alt.jpg"),
    6: ("mysore-emerald.jpg", "mysore-emerald-alt.jpg"),
    7: ("tussar-gold.jpg", "mysore-emerald.jpg"),
    8: ("bridal-ruby.jpg", "bridal-ruby-alt.jpg"),
    9: ("dhoti-gold.jpg", "dhoti-gold-alt.jpg"),
    10: ("veshti-kanjivaram.jpg", "veshti-kanjivaram-alt.jpg"),
    11: ("shirt-forest.jpg", "shirt-forest-alt.jpg"),
    12: ("kurta-ivory.jpg", "kurta-ivory-alt.jpg"),
    13: ("kurta-black.jpg", "kurta-black-alt.jpg"),
    14: ("kurta-mustard.jpg", "kurta-mustard-alt.jpg"),
    15: ("kurta-copper.jpg", "kurta-copper-alt.jpg"),
}


def asset(name: str) -> str:
    return f"/images/catalog/{name}"


class Command(BaseCommand):
    help = "Point product images at local premium /images/catalog assets"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would change and write nothing.",
        )
        parser.add_argument(
            "--yes",
            action="store_true",
            help="Skip the confirmation prompt (required for non-interactive runs).",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        # CATALOG_MAP is keyed on hardcoded ids 1-15 and deletes every existing image for
        # each one. Against a live catalog that irreversibly destroys admin-uploaded photos
        # and attaches the wrong images to whatever now occupies those ids, so make the
        # destructive path opt-in — repo convention is --dry-run/--check on such scripts.
        targets = {
            product_id: Product.objects.filter(id=product_id).first()
            for product_id in CATALOG_MAP
        }
        present = {pid: p for pid, p in targets.items() if p}
        doomed = ProductImage.objects.filter(product_id__in=present).count()

        self.stdout.write(
            f"{len(present)} of {len(CATALOG_MAP)} mapped products exist; "
            f"{doomed} existing ProductImage rows would be deleted."
        )
        for product_id, product in sorted(present.items()):
            primary, _ = CATALOG_MAP[product_id]
            self.stdout.write(f"  #{product_id} {product.name} -> {primary}")

        if dry_run:
            self.stdout.write(self.style.WARNING("Dry run — nothing written."))
            return

        if not options["yes"]:
            answer = input(f"Delete {doomed} image rows and replace them? [y/N] ").strip().lower()
            if answer not in {"y", "yes"}:
                self.stdout.write(self.style.WARNING("Aborted."))
                return

        updated = 0
        with transaction.atomic():
            for product_id, (primary, secondary) in CATALOG_MAP.items():
                product = targets.get(product_id)
                if not product:
                    self.stdout.write(self.style.WARNING(f"Skip missing product id={product_id}"))
                    continue

                # Drop old gallery noise; set two clean catalog shots
                ProductImage.objects.filter(product=product).delete()
                ProductImage.objects.create(
                    product=product,
                    image_url=asset(primary),
                    alt_text=product.name,
                    sort_order=0,
                    is_primary=True,
                )
                ProductImage.objects.create(
                    product=product,
                    image_url=asset(secondary),
                    alt_text=f"{product.name} alternate view",
                    sort_order=1,
                    is_primary=False,
                )
                updated += 1

        self.stdout.write(self.style.SUCCESS(f"Updated images for {updated} products."))

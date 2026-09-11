from __future__ import annotations

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from accounts.models import Address
from catalog.migrations._attribute_backfill import FABRIC_MAP, WORK_MAP, ZARI_MAP
from catalog.models import AttributeOption, Category, Product, ProductImage, ProductVariant
from inventory.models import StockLedger
from loyalty.models import LoyaltyReward
from orders.models import Coupon
from reviews.models import ProductReview

User = get_user_model()


PRODUCTS = [
    {
        "category": ("kanjivaram", "Kanjivaram", "women"),
        "name": "Royal Kanjivaram Gold Zari Silk Saree",
        "slug": "royal-kanjivaram-gold-zari",
        "hook": "The crown jewel of every bridal trousseau",
        "gender": "women",
        "tags": ["kanjivaram", "bridal", "bestseller"],
        "occasions": ["Wedding", "Engagement", "Festive"],
        "price": "12999.00",
        "mrp": "15999.00",
        "stock": 15,
        "color": ("Gold", "#C4923A"),
        "fabric": "Pure Kanjivaram Silk",
        "zari": "Real Gold Zari",
        "featured": True,
        "deal": "Wedding Store Deal",
        "image": 27575174,
        "rating": "4.8",
        "sold": 184,
    },
    {
        "category": ("kanjivaram", "Kanjivaram", "women"),
        "name": "Temple Border Kanjivaram Silk Saree",
        "slug": "temple-border-kanjivaram",
        "hook": "Divine temple motifs meet timeless silk",
        "gender": "women",
        "tags": ["kanjivaram", "traditional", "festive"],
        "occasions": ["Wedding", "Pooja", "Festival"],
        "price": "8999.00",
        "mrp": "11999.00",
        "stock": 22,
        "color": ("Maroon", "#8B1A1A"),
        "fabric": "Kanjivaram Silk",
        "zari": "Silver and Gold Zari",
        "featured": True,
        "deal": "Bank Offer Eligible",
        "image": 29049358,
        "rating": "4.7",
        "sold": 142,
    },
    {
        "category": ("banarasi", "Banarasi", "women"),
        "name": "Banarasi Silk Saree with Zari Brocade",
        "slug": "banarasi-zari-brocade",
        "hook": "Varanasi's finest brocade artistry",
        "gender": "women",
        "tags": ["banarasi", "party-wear"],
        "occasions": ["Festival", "Party", "Reception"],
        "price": "7999.00",
        "mrp": "9999.00",
        "stock": 18,
        "color": ("Peach", "#E8A68A"),
        "fabric": "Banarasi Silk",
        "zari": "Silver Zari",
        "featured": True,
        "deal": "Festive Price Drop",
        "image": 35108853,
        "rating": "4.6",
        "sold": 126,
    },
    {
        "category": ("patola", "Patola", "women"),
        "name": "Double Ikat Patola Silk Saree",
        "slug": "double-ikat-patola-silk",
        "hook": "Mastercraft double ikat from Patan",
        "gender": "women",
        "tags": ["patola", "ikat", "heritage", "rare"],
        "occasions": ["Wedding", "Heirloom", "Special Occasion"],
        "price": "18999.00",
        "mrp": "24999.00",
        "stock": 6,
        "color": ("Magenta", "#B01868"),
        "fabric": "Pure Patola Silk",
        "zari": "Real Gold Zari",
        "featured": True,
        "deal": "Rare Weave",
        "image": 28943610,
        "rating": "4.9",
        "sold": 64,
    },
    {
        "category": ("daily-silk", "Daily Silk", "women"),
        "name": "Elegant Pastel Daily Silk Saree",
        "slug": "elegant-pastel-daily-silk",
        "hook": "Soft pastels for office and everyday occasions",
        "gender": "women",
        "tags": ["daily", "office", "lightweight"],
        "occasions": ["Daily", "Office"],
        "price": "3299.00",
        "mrp": "4299.00",
        "stock": 25,
        "color": ("Mint", "#7BBF9E"),
        "fabric": "Soft Silk",
        "zari": "Minimal Zari",
        "featured": False,
        "deal": "Everyday Value",
        "image": 34107842,
        "rating": "4.4",
        "sold": 211,
    },
    {
        "category": ("mysore", "Mysore Silk", "women"),
        "name": "Mysore Crepe Silk Saree Emerald",
        "slug": "mysore-crepe-silk-emerald",
        "hook": "Soft crepe silk with a rich emerald fall",
        "gender": "women",
        "tags": ["mysore", "office", "premium"],
        "occasions": ["Office", "Festival", "Reception"],
        "price": "6499.00",
        "mrp": "8499.00",
        "stock": 14,
        "color": ("Emerald", "#0F6A52"),
        "fabric": "Mysore Crepe Silk",
        "zari": "Fine Zari Border",
        "featured": False,
        "deal": "Fresh Arrival",
        "image": 36848911,
        "rating": "4.5",
        "sold": 73,
    },
    {
        "category": ("tussar", "Tussar Silk", "women"),
        "name": "Handloom Tussar Silk Saree Natural Gold",
        "slug": "handloom-tussar-natural-gold",
        "hook": "Textured handloom silk for refined day events",
        "gender": "women",
        "tags": ["tussar", "handloom", "lightweight"],
        "occasions": ["Office", "Pooja", "Gifting"],
        "price": "4599.00",
        "mrp": "5999.00",
        "stock": 19,
        "color": ("Natural Gold", "#D5B36A"),
        "fabric": "Tussar Silk",
        "zari": "Antique Zari",
        "featured": False,
        "deal": "Handloom Edit",
        "image": 1488463,
        "rating": "4.3",
        "sold": 96,
    },
    {
        "category": ("bridal", "Bridal Sarees", "women"),
        "name": "Ruby Bridal Kanjivaram Silk Saree",
        "slug": "ruby-bridal-kanjivaram-silk",
        "hook": "Heavy bridal silk with grand zari pallu",
        "gender": "women",
        "tags": ["bridal", "kanjivaram", "wedding"],
        "occasions": ["Wedding", "Reception", "Engagement"],
        "price": "21999.00",
        "mrp": "28999.00",
        "stock": 5,
        "color": ("Ruby", "#9F1E34"),
        "fabric": "Pure Kanjivaram Silk",
        "zari": "Real Gold Zari",
        "featured": True,
        "deal": "Bridal Bestseller",
        "image": 29049358,
        "rating": "4.9",
        "sold": 38,
    },
    {
        "category": ("mens-dhoti", "Silk Dhoti", "men"),
        "name": "Pure Silk Dhoti Gold Border",
        "slug": "pure-silk-dhoti-gold-border",
        "hook": "Classic gold zari border for temple and wedding wear",
        "gender": "men",
        "tags": ["dhoti", "wedding", "traditional"],
        "occasions": ["Wedding", "Temple", "Festival"],
        "price": "4999.00",
        "mrp": "6499.00",
        "stock": 20,
        "color": ("Cream", "#F5E4B8"),
        "fabric": "Pure Silk",
        "zari": "Gold Border",
        "featured": True,
        "deal": "Wedding Essential",
        "image": 11950924,
        "rating": "4.6",
        "sold": 155,
    },
    {
        "category": ("mens-veshti", "Veshti", "men"),
        "name": "Kanjivaram Silk Veshti Traditional",
        "slug": "kanjivaram-silk-veshti-traditional",
        "hook": "Traditional Tamil veshti woven in pure silk",
        "gender": "men",
        "tags": ["veshti", "traditional"],
        "occasions": ["Wedding", "Temple", "Festival"],
        "price": "3499.00",
        "mrp": "4499.00",
        "stock": 30,
        "color": ("White", "#FFFFFF"),
        "fabric": "Pure Kanjivaram Silk",
        "zari": "Gold Zari",
        "featured": False,
        "deal": "Temple Wear",
        "image": 18194586,
        "rating": "4.5",
        "sold": 178,
    },
    {
        "category": ("mens-shirt", "Silk Shirt", "men"),
        "name": "Silk Shirt Deep Forest Green",
        "slug": "silk-shirt-deep-forest-green",
        "hook": "Luxurious silk shirt for weddings and formal events",
        "gender": "men",
        "tags": ["shirt", "festive"],
        "occasions": ["Wedding", "Party"],
        "price": "5499.00",
        "mrp": "7000.00",
        "stock": 12,
        "color": ("Forest Green", "#185A28"),
        "fabric": "Raw Silk",
        "zari": "Thread Embroidery",
        "featured": True,
        "deal": "Limited Stock",
        "image": 7671168,
        "rating": "4.4",
        "sold": 89,
    },
    {
        "category": ("mens-kurta", "Silk Kurta", "men"),
        "name": "Ivory Silk Kurta Wedding Set",
        "slug": "ivory-silk-kurta-wedding-set",
        "hook": "Ivory silk kurta with coordinated festive finish",
        "gender": "men",
        "tags": ["kurta", "wedding", "set"],
        "occasions": ["Wedding", "Reception", "Festival"],
        "price": "6999.00",
        "mrp": "8999.00",
        "stock": 16,
        "color": ("Ivory", "#F2E4C9"),
        "fabric": "Silk Blend",
        "zari": "Thread Embroidery",
        "featured": True,
        "deal": "Wedding Store Deal",
        "image": 6068960,
        "rating": "4.7",
        "sold": 72,
    },
    {
        "category": ("mens-kurta", "Silk Kurta", "men"),
        "name": "Midnight Black Silk Kurta",
        "slug": "midnight-black-silk-kurta",
        "hook": "Minimal black silk kurta for evening functions",
        "gender": "men",
        "tags": ["kurta", "party", "premium"],
        "occasions": ["Party", "Reception", "Festival"],
        "price": "5999.00",
        "mrp": "7999.00",
        "stock": 11,
        "color": ("Black", "#111111"),
        "fabric": "Raw Silk",
        "zari": "Self Weave",
        "featured": False,
        "deal": "Premium Pick",
        "image": 8770930,
        "rating": "4.5",
        "sold": 44,
    },
    {
        "category": ("mens-kurta", "Silk Kurta", "men"),
        "name": "Mustard Festive Silk Kurta",
        "slug": "mustard-festive-silk-kurta",
        "hook": "Bright festive silk kurta for haldi and temple visits",
        "gender": "men",
        "tags": ["kurta", "haldi", "festival"],
        "occasions": ["Festival", "Haldi", "Temple"],
        "price": "4299.00",
        "mrp": "5499.00",
        "stock": 24,
        "color": ("Mustard", "#C78B1D"),
        "fabric": "Silk Cotton",
        "zari": "Minimal Border",
        "featured": False,
        "deal": "Fast Moving",
        "image": 34423743,
        "rating": "4.2",
        "sold": 119,
    },
    {
        "category": ("mens-set", "Wedding Sets", "men"),
        "name": "Copper Silk Wedding Kurta Set",
        "slug": "copper-silk-wedding-kurta-set",
        "hook": "Coordinated silk set for groom-side ceremonies",
        "gender": "men",
        "tags": ["set", "wedding", "groom"],
        "occasions": ["Wedding", "Engagement", "Reception"],
        "price": "9999.00",
        "mrp": "12999.00",
        "stock": 9,
        "color": ("Copper", "#B66A35"),
        "fabric": "Dupion Silk",
        "zari": "Antique Thread Work",
        "featured": True,
        "deal": "Groom Edit",
        "image": 7956933,
        "rating": "4.8",
        "sold": 31,
    },
]


SERVICEABLE_PINS = ["600001", "600017", "631501", "560001", "400001", "110001", "500001", "700001"]


def _option(key: str, slug: str | None):
    """Look up a seeded AttributeOption, or None when the fixture has no value for it."""
    if not slug:
        return None
    return AttributeOption.objects.filter(key=key, value_slug=slug).first()


class Command(BaseCommand):
    help = "Seed CSM Silks starter retailer catalog data."

    @transaction.atomic
    def handle(self, *args, **options):
        admin = self._upsert_user(
            username="admin",
            email="admin@csmsilks.com",
            phone="+919999999999",
            password="admin123",
            full_name="CSM Admin",
            role=User.Role.SUPER_ADMIN,
            is_staff=True,
            is_superuser=True,
        )
        customer = self._upsert_user(
            username="+918888888888",
            email="customer@example.com",
            phone="+918888888888",
            password="customer123",
            full_name="Test Customer",
            role=User.Role.CUSTOMER,
            is_staff=False,
            is_superuser=False,
        )
        address_defaults = {
            "full_name": "Test Customer",
            "phone": "+918888888888",
            "address_line_1": "12 Silk Street",
            "address_line_2": "Near Temple Tank",
            "city": "Kanchipuram",
            "state": "Tamil Nadu",
            "pin_code": "631501",
            "is_default": True,
        }
        address = Address.objects.filter(user=customer, label="Home").first()
        if address:
            for key, value in address_defaults.items():
                setattr(address, key, value)
            address.save()
        else:
            Address.objects.create(user=customer, label="Home", **address_defaults)

        for pdata in PRODUCTS:
            slug, category_name, gender = pdata["category"]
            category, _ = Category.objects.get_or_create(slug=slug, defaults={"name": category_name, "gender": gender})
            # The fixture still describes fabric/zari as free text; the same mapping
            # tables the backfill migration uses turn them into controlled options, so
            # a freshly seeded database matches a migrated one exactly.
            zari_slug, border_slug = ZARI_MAP.get(pdata["zari"], (None, None))
            fabric_option = _option("fabric", FABRIC_MAP.get(pdata["fabric"]))
            product, _ = Product.objects.update_or_create(
                slug=pdata["slug"],
                defaults={
                    "name": pdata["name"],
                    "hook": pdata["hook"],
                    "description": f"{pdata['name']} from CSM Silks, crafted for {', '.join(pdata['occasions'])}.",
                    "category": category,
                    "gender": pdata["gender"],
                    "tags": pdata["tags"],
                    "occasions": pdata["occasions"],
                    "fabric": fabric_option,
                    "zari": _option("zari", zari_slug),
                    "border": _option("border", border_slug),
                    "work": _option("work", WORK_MAP.get(pdata["zari"])),
                    "brand": "CSM Silks",
                    "seller_name": "CSM Silks Kanchipuram",
                    "base_price": Decimal(pdata["price"]),
                    "base_mrp": Decimal(pdata["mrp"]),
                    "deal_label": pdata["deal"],
                    "key_highlights": [
                        # Canonical option label, not the raw fixture string — matches the
                        # quick-create path (serializers.py) so key_highlights never disagrees
                        # with the typed Fabric row rendered on the same PDP (C6). Falls back to
                        # the raw fixture text only if the fixture has no matching option.
                        fabric_option.label if fabric_option else pdata["fabric"],
                        pdata["zari"],
                        "Blouse piece included" if pdata["gender"] == "women" else "Wedding and temple ready",
                        "Dry clean only",
                    ],
                    "specifications": {
                        "Brand": "CSM Silks",
                        "Fabric": pdata["fabric"],
                        "Occasion": ", ".join(pdata["occasions"]),
                        "HSN": "5007",
                        "Origin": "Kanchipuram curated collection",
                    },
                    "serviceable_pin_codes": SERVICEABLE_PINS,
                    "delivery_min_days": 2,
                    "delivery_max_days": 6 if pdata["gender"] == "women" else 5,
                    "return_days": 15,
                    "cod_available": True,
                    "exchange_available": True,
                    "assured": True,
                    "is_featured": pdata["featured"],
                    "is_gi_tagged": True,
                    "avg_rating": Decimal(pdata["rating"]),
                    "review_count": 3,
                    "total_sold": pdata["sold"],
                },
            )
            color_name, color_hex = pdata["color"]
            sku = "CSM-" + pdata["slug"].upper().replace("-", "-")[:42]
            variant, _ = ProductVariant.objects.update_or_create(
                sku=sku,
                defaults={
                    "product": product,
                    "title": color_name,
                    "color_name": color_name,
                    "color_hex": color_hex,
                    "size": "Free Size" if gender == "women" else "M-XL",
                    "blouse_included": gender == "women",
                    "length_meters": Decimal("6.30") if gender == "women" else None,
                    "care_instructions": "Dry clean only",
                    "price": Decimal(pdata["price"]),
                    "mrp": Decimal(pdata["mrp"]),
                    "cost_price": Decimal(pdata["price"]) * Decimal("0.65"),
                    "stock_qty": pdata["stock"],
                    "reorder_level": 5,
                    "is_active": True,
                },
            )
            StockLedger.objects.get_or_create(
                variant=variant,
                reason=StockLedger.Reason.SEED,
                reference="seed",
                defaults={"quantity_delta": pdata["stock"], "created_by": admin},
            )
            image_url = self._pexels_image(pdata["image"])
            ProductImage.objects.update_or_create(
                product=product,
                variant=variant,
                is_primary=True,
                defaults={"image_url": image_url, "alt_text": product.name, "sort_order": 0},
            )
            self._seed_reviews(product, customer)

        rewards = [
            ("₹200 Off Coupon", "Next order discount", 2000, "discount", "200.00"),
            ("Free Blouse Stitching", "Expert tailoring included", 1500, "service", "750.00"),
            ("Priority Shipping", "Fast dispatch upgrade", 800, "service", "150.00"),
        ]
        for name, description, points, reward_type, value in rewards:
            LoyaltyReward.objects.get_or_create(name=name, defaults={"description": description, "points_required": points, "reward_type": reward_type, "reward_value": Decimal(value)})

        # CSM10/COMEBACK10 were previously hardcoded in orders.pricing and granted
        # unconditionally, so deactivating them was impossible. They are real rows now —
        # edit or switch them off in admin. Production needs these created there too.
        coupons = [
            ("CSM10", "10% off for new customers", Decimal("10.00"), Decimal("0")),
            ("COMEBACK10", "10% off welcome-back offer", Decimal("10.00"), Decimal("0")),
        ]
        for code, description, value, min_order_value in coupons:
            Coupon.objects.get_or_create(
                code=code,
                defaults={
                    "description": description,
                    "discount_type": Coupon.DiscountType.PERCENT,
                    "value": value,
                    "min_order_value": min_order_value,
                    "is_active": True,
                },
            )

        self.stdout.write(self.style.SUCCESS("Seeded CSM Silks Django retailer data."))
        self.stdout.write("Admin: admin@csmsilks.com / admin123")
        self.stdout.write("Customer OTP phone: +918888888888")

    def _upsert_user(self, **kwargs):
        password = kwargs.pop("password")
        user, _ = User.objects.update_or_create(
            username=kwargs["username"],
            defaults={**kwargs, "is_active": True, "is_verified": True},
        )
        user.set_password(password)
        user.save()
        return user

    def _pexels_image(self, photo_id: int) -> str:
        # Local placeholder avoids flaky third-party CDNs in dev/E2E browsers.
        return "/placeholder-product.svg"

    def _seed_reviews(self, product: Product, customer) -> None:
        reviews = [
            (5, "Beautiful finish", f"The {product.category.name.lower()} quality feels premium and the packing was careful."),
            (5, "Worth the price", "The fabric, zari work, and color looked excellent for our function."),
            (4, "Good delivery", "Reached safely with invoice and care instructions included."),
        ]
        for rating, title, body in reviews:
            ProductReview.objects.update_or_create(
                product=product,
                user=customer,
                title=title,
                defaults={
                    "rating": rating,
                    "body": body,
                    "is_verified_purchase": True,
                    "is_published": True,
                },
            )

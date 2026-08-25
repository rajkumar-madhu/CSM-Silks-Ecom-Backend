from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from inventory.models import StockLedger

from .models import AttributeOption, Category, Product, ProductVariant, StockAlert
from .tasks import notify_restocked_watchers

User = get_user_model()


class _FakeChannelLayer:
    def __init__(self):
        self.messages = []

    async def group_send(self, group, message):
        self.messages.append((group, message))


class CatalogRealtimeTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="catalog-admin",
            email="catalog-admin@csmsilks.com",
            password="admin123",
            is_staff=True,
            role="admin",
        )
        self.category = Category.objects.create(name="Kanjivaram", slug="kanjivaram", gender="women")
        self.product = Product.objects.create(
            name="Realtime Silk Saree",
            slug="realtime-silk-saree",
            category=self.category,
            gender="women",
            base_price=2500,
            base_mrp=3200,
            is_active=True,
        )
        self.variant = ProductVariant.objects.create(
            product=self.product,
            sku="RT-SILK-1",
            price=2500,
            mrp=3200,
            stock_qty=4,
            reorder_level=2,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    @patch("catalog.realtime.get_channel_layer")
    def test_admin_inventory_adjustment_publishes_catalog_stock_event(self, get_channel_layer):
        channel_layer = _FakeChannelLayer()
        get_channel_layer.return_value = channel_layer

        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                "/api/admin/inventory",
                {"variant_id": self.variant.id, "quantity_delta": 3, "note": "QA stock receipt"},
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_qty, 7)
        self.assertEqual(StockLedger.objects.filter(variant=self.variant).count(), 1)
        groups = [group for group, _message in channel_layer.messages]
        self.assertIn("catalog_public", groups)
        self.assertIn("catalog_admin", groups)
        payload = channel_layer.messages[0][1]["payload"]
        self.assertEqual(payload["type"], "inventory.variant.updated")
        self.assertEqual(payload["product_id"], self.product.id)
        self.assertEqual(payload["variant"]["available_qty"], 7)

    @patch("catalog.realtime.get_channel_layer")
    def test_quick_create_product_publishes_catalog_create_event(self, get_channel_layer):
        channel_layer = _FakeChannelLayer()
        get_channel_layer.return_value = channel_layer

        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                "/api/admin/products/quick-create",
                {
                    "name": "Live Published Saree",
                    "gender": "women",
                    "category_name": "Bridal",
                    "price": "4500.00",
                    "mrp": "5200.00",
                    "stock_qty": 6,
                    "color_name": "Maroon",
                    "fabric": "Pure silk",
                },
                format="json",
            )

        self.assertEqual(response.status_code, 201)
        payload = channel_layer.messages[0][1]["payload"]
        self.assertEqual(payload["type"], "catalog.product.created")
        self.assertEqual(payload["product"]["name"], "Live Published Saree")
        self.assertEqual(payload["product"]["available_qty"], 6)


class AdminCatalogCrudTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin",
            email="admin@csmsilks.com",
            password="admin123",
            is_staff=True,
            role="admin",
        )
        self.category = Category.objects.create(name="Kurta", slug="kurta", gender="men")
        self.product = Product.objects.create(
            name="Ivory Silk Kurta Wedding Set",
            slug="ivory-silk-kurta-wedding-set",
            category=self.category,
            gender="men",
            hook="Handwoven silk kurta for wedding celebrations",
            deal_label="Wedding special",
            base_price=8990,
            base_mrp=12990,
            is_active=True,
            is_featured=True,
        )
        self.variant = ProductVariant.objects.create(
            product=self.product,
            sku="KURTA-IVORY-1",
            price=8990,
            mrp=12990,
            stock_qty=12,
            reorder_level=2,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_admin_product_detail_returns_existing_fields(self):
        response = self.client.get(f"/api/admin/products/{self.product.id}")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["name"], "Ivory Silk Kurta Wedding Set")
        self.assertEqual(data["hook"], "Handwoven silk kurta for wedding celebrations")
        self.assertEqual(data["deal_label"], "Wedding special")
        self.assertEqual(data["is_featured"], True)
        self.assertEqual(data["is_active"], True)
        self.assertEqual(str(data["price"]), "8990.00")
        self.assertEqual(str(data["mrp"]), "12990.00")
        self.assertEqual(len(data["variants"]), 1)
        self.assertEqual(data["variants"][0]["id"], self.variant.id)
        self.assertEqual(data["variants"][0]["stock_qty"], 12)
        self.assertEqual(data["variant_id"], self.variant.id)

    def test_admin_product_detail_requires_staff(self):
        guest = APIClient()
        response = guest.get(f"/api/admin/products/{self.product.id}")
        self.assertEqual(response.status_code, 401)

    def test_admin_patch_product_and_variant_round_trip(self):
        product_response = self.client.patch(
            f"/api/admin/products/{self.product.id}",
            {
                "name": "Ivory Silk Kurta Updated",
                "hook": "Updated selling line",
                "deal_label": "Festive offer",
                "is_featured": False,
                "is_active": True,
                "base_price": "9490.00",
                "base_mrp": "13490.00",
            },
            format="json",
        )
        self.assertEqual(product_response.status_code, 200)
        variant_response = self.client.patch(
            f"/api/admin/variants/{self.variant.id}",
            {"price": "9490.00", "mrp": "13490.00", "stock_qty": 18},
            format="json",
        )
        self.assertEqual(variant_response.status_code, 200)

        detail = self.client.get(f"/api/admin/products/{self.product.id}").json()
        self.assertEqual(detail["name"], "Ivory Silk Kurta Updated")
        self.assertEqual(detail["hook"], "Updated selling line")
        self.assertEqual(detail["deal_label"], "Festive offer")
        self.assertEqual(detail["is_featured"], False)
        self.assertEqual(str(detail["price"]), "9490.00")
        self.assertEqual(str(detail["mrp"]), "13490.00")
        self.assertEqual(detail["variants"][0]["stock_qty"], 18)

    def test_admin_product_list_includes_active_flag(self):
        response = self.client.get("/api/admin/products")

        self.assertEqual(response.status_code, 200)
        items = response.json()["items"]
        row = next(item for item in items if item["id"] == self.product.id)
        self.assertEqual(row["name"], "Ivory Silk Kurta Wedding Set")
        self.assertEqual(row["is_active"], True)
        self.assertEqual(row["variant_id"], self.variant.id)

    def test_stock_alert_captures_waitlist_when_sold_out(self):
        self.variant.stock_qty = 0
        self.variant.save(update_fields=["stock_qty"])
        response = APIClient().post(
            f"/api/products/{self.product.slug}/stock-alert",
            {"phone": "9876543210", "variant_id": self.variant.id},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["sku"], self.variant.sku)


class StockAlertValidationTests(TestCase):
    """StockAlertView is AllowAny and took raw request.data, so bad input 500'd."""

    def setUp(self):
        self.client = APIClient()
        category = Category.objects.create(name="Silk", slug="silk-alert")
        self.product = Product.objects.create(name="Alert Saree", slug="alert-saree", category=category, is_active=True)
        self.variant = ProductVariant.objects.create(
            product=self.product, sku="ALERT-1", price=Decimal("1000.00"), mrp=Decimal("1200.00"), stock_qty=0
        )

    def url(self):
        return f"/api/products/{self.product.slug}/stock-alert"

    def test_non_numeric_variant_id_returns_400(self):
        resp = self.client.post(self.url(), {"phone": "9876543210", "variant_id": "abc"}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_overlong_phone_returns_400(self):
        # StockAlert.phone is max_length=15; Postgres would raise "value too long".
        resp = self.client.post(self.url(), {"phone": "9" * 25}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(StockAlert.objects.exists())

    def test_short_phone_still_returns_400(self):
        resp = self.client.post(self.url(), {"phone": "12345"}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_valid_request_creates_alert(self):
        resp = self.client.post(self.url(), {"phone": "9876543210", "variant_id": self.variant.id}, format="json")
        self.assertIn(resp.status_code, (200, 201))
        alert = StockAlert.objects.get()
        self.assertEqual(alert.phone, "+919876543210")
        self.assertIsNone(alert.notified_at)


class RestockNotificationTests(TestCase):
    """The waitlist was write-only: nothing read StockAlert and notified_at never got set."""

    def setUp(self):
        category = Category.objects.create(name="Silk", slug="silk-restock")
        self.product = Product.objects.create(name="Restock Saree", slug="restock-saree", category=category, is_active=True)
        self.variant = ProductVariant.objects.create(
            product=self.product, sku="RESTOCK-1", price=Decimal("1000.00"), mrp=Decimal("1200.00"), stock_qty=0
        )
        self.alert = StockAlert.objects.create(variant=self.variant, phone="+919876543210", email="watch@example.com")

    def test_out_of_stock_variant_is_not_notified(self):
        with patch("catalog.tasks.resend_configured", return_value=True), \
             patch("catalog.tasks.send_resend_email") as send:
            result = notify_restocked_watchers()
        self.assertEqual(result["notified"], 0)
        send.assert_not_called()
        self.alert.refresh_from_db()
        self.assertIsNone(self.alert.notified_at)

    def test_restocked_variant_notifies_and_stamps_once(self):
        self.variant.stock_qty = 5
        self.variant.save(update_fields=["stock_qty"])

        with patch("catalog.tasks.resend_configured", return_value=True), \
             patch("catalog.tasks.gupshup_configured", return_value=False), \
             patch("catalog.tasks.send_resend_email") as send:
            result = notify_restocked_watchers()
        self.assertEqual(result["notified"], 1)
        self.assertEqual(send.call_count, 1)
        self.alert.refresh_from_db()
        self.assertIsNotNone(self.alert.notified_at)

        # A second run must not re-notify.
        with patch("catalog.tasks.resend_configured", return_value=True), \
             patch("catalog.tasks.send_resend_email") as send_again:
            result = notify_restocked_watchers()
        self.assertEqual(result["notified"], 0)
        send_again.assert_not_called()

    def test_unconfigured_provider_leaves_alert_pending_for_retry(self):
        self.variant.stock_qty = 5
        self.variant.save(update_fields=["stock_qty"])

        with patch("catalog.tasks.resend_configured", return_value=False), \
             patch("catalog.tasks.gupshup_configured", return_value=False):
            result = notify_restocked_watchers()
        self.assertEqual(result["notified"], 0)
        self.alert.refresh_from_db()
        self.assertIsNone(self.alert.notified_at)


class CatalogFacetCountTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.sarees = Category.objects.create(name="Kanjivaram", slug="kanjivaram", gender="women")
        self.bridal = Category.objects.create(name="Bridal", slug="bridal", gender="women")
        # Fabric is a controlled Product attribute now, not free text on the variant.
        self.pure_silk = AttributeOption.objects.create(key="fabric", value_slug="pure-silk-test", label="Pure silk")
        self.mysore = AttributeOption.objects.create(key="fabric", value_slug="mysore-silk-test", label="Mysore silk")
        self.ruby = Product.objects.create(
            name="Ruby Bridal Kanjivaram",
            slug="ruby-bridal-kanjivaram",
            category=self.bridal,
            gender="women",
            occasions=["Wedding", "Festive"],
            fabric=self.pure_silk,
            base_price=15990,
            base_mrp=19990,
            is_active=True,
        )
        ProductVariant.objects.create(
            product=self.ruby,
            sku="RUBY-1",
            price=15990,
            mrp=19990,
            stock_qty=5,
            color_name="Red",
            color_hex="#a01c1c",
        )
        self.emerald = Product.objects.create(
            name="Emerald Mysore Silk",
            slug="emerald-mysore-silk",
            category=self.sarees,
            gender="women",
            occasions=["Festive"],
            fabric=self.mysore,
            base_price=8990,
            base_mrp=10990,
            is_active=True,
        )
        ProductVariant.objects.create(
            product=self.emerald,
            sku="EMER-1",
            price=8990,
            mrp=10990,
            stock_qty=8,
            color_name="Green",
            color_hex="#116644",
        )

    def test_facets_include_counts(self):
        response = self.client.get("/api/catalog/facets", {"gender": "women"})

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["total"], 2)
        self.assertEqual(data["category_counts"], {"bridal": 1, "kanjivaram": 1})
        color_counts = {row["color_name"]: row["count"] for row in data["colors"]}
        self.assertEqual(color_counts, {"Red": 1, "Green": 1})
        fabric_counts = {row["name"]: row["count"] for row in data["fabric_counts"]}
        self.assertEqual(fabric_counts, {"Pure silk": 1, "Mysore silk": 1})
        occasion_counts = {row["name"]: row["count"] for row in data["occasion_counts"]}
        self.assertEqual(occasion_counts, {"Wedding": 1, "Festive": 2})
        # Legacy fields stay intact for older clients.
        self.assertEqual(sorted(data["fabrics"]), ["Mysore silk", "Pure silk"])
        self.assertEqual(sorted(data["occasions"]), ["Festive", "Wedding"])

    def test_facets_counts_respect_active_filters(self):
        response = self.client.get("/api/catalog/facets", {"gender": "women", "color": "Red"})

        data = response.json()
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["category_counts"], {"bridal": 1})

    def test_legacy_fabric_fields_hide_parked_and_retired_options(self):
        # C5: fabrics/fabric_counts are the legacy fields CatalogToolbar/pages/Search.tsx still
        # read. They must apply the same is_filterable/is_active gate as _attribute_groups, or a
        # parked ("needs review") or retired fabric option re-exposes the exact fragmentation
        # this feature exists to remove.
        parked = AttributeOption.objects.create(
            key="fabric", value_slug="parked-silk-test", label="Parked silk", is_filterable=False
        )
        retired = AttributeOption.objects.create(
            key="fabric", value_slug="retired-silk-test", label="Retired silk", is_active=False
        )
        Product.objects.create(
            name="Parked Fabric Product", slug="parked-fabric-product", category=self.sarees, gender="women",
            fabric=parked, base_price=100, base_mrp=200, is_active=True,
        )
        Product.objects.create(
            name="Retired Fabric Product", slug="retired-fabric-product", category=self.sarees, gender="women",
            fabric=retired, base_price=100, base_mrp=200, is_active=True,
        )

        data = self.client.get("/api/catalog/facets", {"gender": "women"}).json()

        self.assertNotIn("Parked silk", data["fabrics"])
        self.assertNotIn("Retired silk", data["fabrics"])
        fabric_counts = {row["name"]: row["count"] for row in data["fabric_counts"]}
        self.assertNotIn("Parked silk", fabric_counts)
        self.assertNotIn("Retired silk", fabric_counts)
        # The two already-filterable/active fabrics from setUp must still be counted —
        # semantics of the fully-filtered fields are pinned, not just "something changed".
        self.assertEqual(fabric_counts, {"Pure silk": 1, "Mysore silk": 1})

    def test_products_accept_multi_value_facets(self):
        response = self.client.get("/api/products", {"gender": "women", "color": "Red,Green"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total"], 2)

        response = self.client.get("/api/products", {"gender": "women", "fabric": "Pure silk,Mysore silk"})
        self.assertEqual(response.json()["total"], 2)

        response = self.client.get("/api/products", {"gender": "women", "occasion": "Wedding"})
        self.assertEqual(response.json()["total"], 1)

        response = self.client.get("/api/products", {"gender": "women", "color": "Red"})
        self.assertEqual(response.json()["total"], 1)


class SeedCsmKeyHighlightsTests(TestCase):
    def test_seeder_writes_the_canonical_fabric_label_into_key_highlights(self):
        # C6: seed_csm used to write the raw fixture string ("Pure Kanjivaram Silk") into
        # key_highlights while the typed Fabric row (from the shared FABRIC_MAP) read
        # "Kanjivaram Silk" — both rendered on the same PDP, contradicting each other. The
        # seeder must agree with the quick-create path (serializers.py) and use the canonical
        # AttributeOption.label.
        from django.core.management import call_command

        from catalog.models import Product

        call_command("seed_csm")
        product = Product.objects.get(slug="ruby-bridal-kanjivaram-silk")
        self.assertEqual(product.fabric.label, "Kanjivaram Silk")
        self.assertEqual(product.key_highlights[0], "Kanjivaram Silk")
        self.assertNotIn("Pure Kanjivaram Silk", product.key_highlights)


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
        # value_slug deliberately avoids "woven" (and any other seeded work slug):
        # the seed migration already inserts key="work", value_slug="woven", so
        # reusing it would collide on the very first create() below, before the
        # assertRaises block that is meant to observe the collision.
        from django.db.utils import IntegrityError
        from catalog.models import AttributeOption

        AttributeOption.objects.create(key=AttributeOption.Key.WORK, value_slug="hand-stitched", label="Hand-stitched")
        with self.assertRaises(IntegrityError):
            AttributeOption.objects.create(key=AttributeOption.Key.WORK, value_slug="hand-stitched", label="Hand-stitched Again")

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


class SareeAttributeBackfillTests(TestCase):
    """The backfill is the whole point of this task: it must collapse duplicate
    fabric labels, move a border value out of the zari column, and never silently
    drop an unrecognised string."""

    def _product(self, slug):
        category, _ = Category.objects.get_or_create(
            slug="backfill-fixture", defaults={"name": "Backfill Fixture", "gender": "women"}
        )
        return Product.objects.create(
            name=slug, slug=slug, category=category, gender="women", base_price=1, base_mrp=1
        )

    def _apply(self, product, fabric="", zari=""):
        """Drive one variant's strings through the backfill exactly as the migration does."""
        from catalog.migrations._attribute_backfill import apply_variant_attributes

        changed, parked = apply_variant_attributes(AttributeOption, product, fabric, zari)
        if changed:
            product.save(update_fields=list(dict.fromkeys(changed)))
        return changed, parked

    def test_duplicate_fabric_labels_collapse_to_one_option(self):
        pure = self._product("collapse-pure-kanjivaram")
        plain = self._product("collapse-kanjivaram")

        self._apply(pure, fabric="Pure Kanjivaram Silk")
        self._apply(plain, fabric="Kanjivaram Silk")

        pure.refresh_from_db()
        plain.refresh_from_db()
        self.assertEqual(pure.fabric.value_slug, "kanjivaram-silk")
        # Two labels, one row: this is the fragmentation the feature exists to end.
        self.assertEqual(pure.fabric_id, plain.fabric_id)
        self.assertEqual(AttributeOption.objects.filter(key="fabric", label__icontains="Kanjivaram").count(), 1)

    def test_fine_zari_border_splits_into_zari_and_border(self):
        product = self._product("split-fine-zari-border")

        self._apply(product, zari="Fine Zari Border")

        product.refresh_from_db()
        self.assertEqual(product.zari.value_slug, "gold-zari")
        self.assertEqual(product.border.value_slug, "zari-border")
        self.assertIsNone(product.work_id)

    def test_work_only_value_sets_work_and_leaves_zari_null(self):
        product = self._product("split-self-weave")

        self._apply(product, zari="Self Weave")

        product.refresh_from_db()
        self.assertEqual(product.work.value_slug, "woven")
        self.assertIsNone(product.zari_id)
        self.assertIsNone(product.border_id)

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
        product = self._product("parked-fabric")

        _changed, parked = self._apply(product, fabric="Moonlight Tissue Silk")

        product.refresh_from_db()
        option = product.fabric
        self.assertIs(option.is_filterable, False)
        # The label is shopper-facing, so it round-trips the raw value with no internal
        # marker; is_filterable is the only review signal. The operator gets this instead:
        self.assertEqual(option.label, "Moonlight Tissue Silk")
        self.assertEqual(parked, ["fabric='Moonlight Tissue Silk' (product parked-fabric)"])

    def test_second_variant_does_not_overwrite_the_first_variants_fabric(self):
        # One Product, two variants — the case the migration's guard exists for. The
        # mapped value must survive; a later unmapped string must not park over it.
        product = self._product("two-variant-product")

        self._apply(product, fabric="Kanjivaram Silk")
        changed, parked = self._apply(product, fabric="Moonlight Tissue Silk")

        product.refresh_from_db()
        self.assertEqual(product.fabric.value_slug, "kanjivaram-silk")
        self.assertEqual(changed, [])
        self.assertEqual(parked, [])
        self.assertFalse(AttributeOption.objects.filter(value_slug="moonlight-tissue-silk").exists())

    def test_variant_serializer_still_exposes_fabric_and_zari_strings(self):
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
        from catalog.serializers import ProductVariantSerializer

        category = Category.objects.create(name="Plain", slug="plain-x", gender="women")
        product = Product.objects.create(
            name="Bare", slug="bare", category=category, gender="women", base_price=1, base_mrp=1
        )
        variant = ProductVariant.objects.create(product=product, sku="BARE-1", price=1, mrp=1, stock_qty=1)
        data = ProductVariantSerializer(variant).data
        self.assertEqual(data["fabric"], "")
        self.assertEqual(data["zari_type"], "")


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

    def test_gender_women_products_in_non_saree_category_yield_no_attribute_groups(self):
        # Regression pin: scope must come from Category.product_type, not from
        # inferring "gender=women means saree" — the exact coupling that field's
        # docstring exists to prevent. A women's listing with zero saree-category
        # products (e.g. all kurtis) must not surface Fabric/Zari/etc groups.
        #
        # Two DISTINCT fabric values are load-bearing here, not one: with a single
        # value the fabric group would be dropped by the unrelated <2-options rule
        # regardless of scoping, so the test would pass even under the old buggy
        # gender=="women" fallback. Two values make the fabric group clear that
        # threshold — the only thing standing between "empty" and "leaks a group"
        # is the category__product_type=SAREE filter this test exists to pin.
        from catalog.models import AttributeOption, Category, Product, ProductVariant

        Product.objects.filter(category=self.saree_cat).delete()
        kurti_cat = Category.objects.create(
            name="Kurtis", slug="kurtis", gender="women", product_type="other"
        )
        kanjivaram = AttributeOption.objects.get(key="fabric", value_slug="kanjivaram-silk")
        patola = AttributeOption.objects.get(key="fabric", value_slug="patola-silk")
        for slug, fabric in [("kurti-1", kanjivaram), ("kurti-2", patola)]:
            kurti = Product.objects.create(
                name=slug, slug=slug, category=kurti_cat, gender="women",
                base_price=100, base_mrp=200, fabric=fabric,
            )
            ProductVariant.objects.create(product=kurti, sku=f"SKU-{slug}", price=100, mrp=200, stock_qty=3)
        self.assertEqual(self._groups({"gender": "women"}), {})

    def test_parked_and_inactive_options_are_excluded_from_counts(self):
        # is_filterable=False parks an unrecognised value; is_active=False retires one.
        # Neither should ever reach the sidebar or inflate/appear in another option's count.
        from catalog.models import AttributeOption, Product, ProductVariant

        parked = AttributeOption.objects.create(
            key="fabric", value_slug="parked-fabric", label="Parked Fabric",
            sort_order=99, is_filterable=False, is_active=True,
        )
        retired = AttributeOption.objects.create(
            key="fabric", value_slug="retired-fabric", label="Retired Fabric",
            sort_order=98, is_filterable=True, is_active=False,
        )
        for slug, option in [("parked-product", parked), ("retired-product", retired)]:
            product = Product.objects.create(
                name=slug, slug=slug, category=self.saree_cat, gender="women",
                base_price=100, base_mrp=200, fabric=option,
            )
            ProductVariant.objects.create(product=product, sku=f"SKU-{slug}", price=100, mrp=200, stock_qty=3)

        groups = self._groups({"gender": "women"})
        slugs = {option["slug"] for option in groups["fabric"]["options"]}
        self.assertNotIn("parked-fabric", slugs)
        self.assertNotIn("retired-fabric", slugs)

    def test_legacy_facet_fields_are_unchanged(self):
        data = self.client.get("/api/catalog/facets", {"gender": "women"}).json()
        for key in ("categories", "colors", "fabrics", "occasions", "price", "sorts", "total",
                    "category_counts", "fabric_counts", "occasion_counts"):
            self.assertIn(key, data)


class AdminAttributeOptionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.staff = User.objects.create_user(
            username="attr-staff", email="staff@csm.test", password="pw12345!", is_staff=True
        )
        self.customer = User.objects.create_user(
            username="attr-customer", email="customer@csm.test", password="pw12345!"
        )

    def test_listing_options_requires_staff(self):
        response = self.client.get("/api/admin/attribute-options")
        self.assertIn(response.status_code, (401, 403))

    def test_create_rejects_authenticated_non_staff(self):
        self.client.force_authenticate(self.customer)
        response = self.client.post(
            "/api/admin/attribute-options",
            {"key": "fabric", "value_slug": "customer-silk", "label": "Customer Silk"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(AttributeOption.objects.filter(value_slug="customer-silk").exists())

    def test_delete_rejects_authenticated_non_staff(self):
        option = AttributeOption.objects.create(key="fabric", value_slug="guarded-silk", label="Guarded Silk")
        self.client.force_authenticate(self.customer)
        response = self.client.delete(f"/api/admin/attribute-options/{option.id}")
        self.assertEqual(response.status_code, 403)
        option.refresh_from_db()
        self.assertTrue(option.is_active)

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
        self.assertTrue(AttributeOption.objects.filter(key="fabric", value_slug="tissue-silk").exists())

    def test_staff_can_patch_an_option(self):
        self.client.force_authenticate(self.staff)
        option = AttributeOption.objects.create(key="fabric", value_slug="temp-silk", label="Temp Silk")
        response = self.client.patch(
            f"/api/admin/attribute-options/{option.id}", {"label": "Updated Silk"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        option.refresh_from_db()
        self.assertEqual(option.label, "Updated Silk")

    def test_delete_soft_deletes_and_survives_product_in_use(self):
        # DELETE must not hard-delete: Product.fabric is on_delete=PROTECT, so removing a
        # row a product points at would raise ProtectedError and surface as a 500.
        category = Category.objects.create(name="Kanjivaram", slug="kanjivaram-delete", gender="women")
        option = AttributeOption.objects.create(key="fabric", value_slug="in-use-silk", label="In Use Silk")
        product = Product.objects.create(
            name="In Use Product",
            slug="in-use-product",
            category=category,
            gender="women",
            base_price=100,
            base_mrp=200,
            fabric=option,
        )
        self.client.force_authenticate(self.staff)
        response = self.client.delete(f"/api/admin/attribute-options/{option.id}")
        self.assertEqual(response.status_code, 204)
        option.refresh_from_db()
        self.assertFalse(option.is_active)
        product.refresh_from_db()
        self.assertEqual(product.fabric_id, option.id)

    def test_quick_create_rejects_an_unknown_fabric(self):
        # Quick-create is where "Pure Kanjivaram Silk" got typed by hand. Close the leak.
        Category.objects.create(name="Kanjivaram", slug="kanjivaram-unknown", gender="women", product_type="saree")
        self.client.force_authenticate(self.staff)
        response = self.client.post(
            "/api/admin/products/quick-create",
            {
                "name": "X",
                "category_name": "Kanjivaram",
                "category_slug": "kanjivaram-unknown",
                "price": "100",
                "mrp": "200",
                "fabric": "Invented Silk",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("fabric", response.json())

    def test_quick_create_accepts_a_known_fabric_slug_and_is_findable_via_facet_and_filter(self):
        Category.objects.create(name="Kanjivaram", slug="kanjivaram-known", gender="women", product_type="saree")
        self.client.force_authenticate(self.staff)
        response = self.client.post(
            "/api/admin/products/quick-create",
            {
                "name": "X",
                "category_name": "Kanjivaram",
                "category_slug": "kanjivaram-known",
                "price": "100",
                "mrp": "200",
                "fabric": "kanjivaram-silk",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        product = Product.objects.get(name="X")
        self.assertEqual(product.fabric.value_slug, "kanjivaram-silk")

        # Regression: fabric must be retrievable, not just set — via ?fabric= filter and the facet.
        filtered = self.client.get("/api/products", {"fabric": "kanjivaram-silk"})
        self.assertEqual(filtered.status_code, 200)
        slugs = {item["slug"] for item in filtered.json()["items"]}
        self.assertIn(product.slug, slugs)

        facets = self.client.get("/api/catalog/facets", {"gender": "women"}).json()
        self.assertIn("Kanjivaram Silk", facets["fabrics"])

    def test_quick_create_rejects_an_unknown_zari_type(self):
        Category.objects.create(name="Kanjivaram", slug="kanjivaram-zari", gender="women", product_type="saree")
        self.client.force_authenticate(self.staff)
        response = self.client.post(
            "/api/admin/products/quick-create",
            {
                "name": "X",
                "category_name": "Kanjivaram",
                "category_slug": "kanjivaram-zari",
                "price": "100",
                "mrp": "200",
                "zari_type": "Invented Zari",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("zari_type", response.json())

    def test_product_patch_rejects_an_option_from_a_different_attribute(self):
        # The vocabulary hole quick-create closed is reopened here if left unguarded: a
        # ModelSerializer FK field with no queryset scoping accepts *any* AttributeOption id,
        # so a fabric option's id could be written into `zari` — a fabric label rendered as a
        # Zari facet checkbox.
        category = Category.objects.create(name="Kanjivaram", slug="kanjivaram-cross-attr", gender="women")
        product = Product.objects.create(
            name="Cross Attr Product",
            slug="cross-attr-product",
            category=category,
            gender="women",
            base_price=100,
            base_mrp=200,
        )
        fabric_option = AttributeOption.objects.create(key="fabric", value_slug="cross-attr-silk", label="Cross Attr Silk")
        self.client.force_authenticate(self.staff)
        response = self.client.patch(
            f"/api/admin/products/{product.id}", {"zari": fabric_option.id}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("zari", response.json())
        product.refresh_from_db()
        self.assertIsNone(product.zari_id)

    def test_product_patch_rejects_a_soft_deleted_option(self):
        # Retirement semantics: an inactive option must stop being *offered*, including as a
        # value a product can be freshly re-pointed at, not just disappear from facets.
        category = Category.objects.create(name="Kanjivaram", slug="kanjivaram-retired-attr", gender="women")
        product = Product.objects.create(
            name="Retired Attr Product",
            slug="retired-attr-product",
            category=category,
            gender="women",
            base_price=100,
            base_mrp=200,
        )
        retired = AttributeOption.objects.create(
            key="fabric", value_slug="retired-again-silk", label="Retired Again Silk", is_active=False
        )
        self.client.force_authenticate(self.staff)
        response = self.client.patch(
            f"/api/admin/products/{product.id}", {"fabric": retired.id}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("fabric", response.json())
        product.refresh_from_db()
        self.assertIsNone(product.fabric_id)

    def test_quick_create_rejects_an_unknown_fabric_for_menswear_too(self):
        # Deliberate: the seeded vocabulary is silk-only, so a menswear quick-create with an
        # unrecognised fabric 400s just like a saree one does — free text on menswear is how
        # this drifted in the first place, and there is no saree-only bypass.
        Category.objects.create(name="Kurta", slug="kurta-menswear-fabric", gender="men", product_type="other")
        self.client.force_authenticate(self.staff)
        response = self.client.post(
            "/api/admin/products/quick-create",
            {
                "name": "X",
                "gender": "men",
                "category_name": "Kurta",
                "category_slug": "kurta-menswear-fabric",
                "price": "100",
                "mrp": "200",
                "fabric": "Cotton",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("fabric", response.json())


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

    def test_attribute_labels_covers_null_typed_attributes_too(self):
        # This is the field the specifications-tail dedup on the PDP is driven off of:
        # it must list every typed-attribute label `attributes` is responsible for,
        # even ones this product leaves null (origin, here) — a null typed attribute
        # still needs its label suppressed from the free-form specifications tail, so
        # the client can't "rescue" an untrustworthy fixture value like a stale Origin
        # string just because the typed FK itself is empty.
        from catalog.models import AttributeOption, Category, Product

        client = APIClient()
        category = Category.objects.create(
            name="Kanjivaram Labels", slug="kanjivaram-labels", gender="women", product_type="saree"
        )
        product = Product.objects.create(
            name="Royal Labels", slug="royal-labels", category=category, gender="women",
            base_price=100, base_mrp=200,
            fabric=AttributeOption.objects.get(key="fabric", value_slug="kanjivaram-silk"),
        )
        self.assertIsNone(product.origin_id)
        labels = client.get("/api/products/royal-labels").json()["attribute_labels"]
        self.assertIn("Fabric", labels)
        self.assertIn("Origin", labels)  # null FK — still listed
        self.assertIn("Occasion", labels)

    def test_attribute_labels_is_empty_for_menswear(self):
        # The typed-attribute vocabulary is saree-only (spec: "menswear gets no PDP
        # spec-table changes"). If attribute_labels reported the saree label list for
        # menswear too, the PDP's specifications-tail dedup would strip keys like
        # Occasion/Origin that have no typed row to replace them (C2 regression).
        from catalog.models import Category, Product

        client = APIClient()
        category = Category.objects.create(
            name="Kurta Labels", slug="kurta-labels", gender="men", product_type="other"
        )
        specs = {"Brand": "CSM", "Fabric": "Silk Blend", "Occasion": "Wedding", "HSN": "6205", "Origin": "India"}
        Product.objects.create(
            name="Wedding Kurta", slug="wedding-kurta-labels", category=category, gender="men",
            base_price=100, base_mrp=200, specifications=specs,
        )
        data = client.get("/api/products/wedding-kurta-labels").json()
        self.assertEqual(data["attribute_labels"], [])
        # specifications itself is an unfiltered passthrough — the dedup happens client-side
        # against attribute_labels, so this pins the full tail is still there to dedup against.
        self.assertEqual(data["specifications"], specs)


class ColourFacetGroupingTests(TestCase):
    """One colour name must be one sidebar row, whatever the variants say about hex.

    The facet used to group by (color_name, color_hex), so a name carried at three
    different hexes rendered three rows of (1) each — while clicking any of them
    filtered on color_name and returned all three products. The count has to
    describe what the click actually does.
    """

    def setUp(self):
        self.client = APIClient()
        category = Category.objects.create(
            name="Bridal", slug="bridal-colour-test", gender="women", product_type="saree"
        )
        # Three products all called "Ruby", disagreeing on hex; two share one value so
        # the representative swatch has a clear majority.
        for index, hex_value in enumerate(("#9F1E34", "#9F1E34", "#6d1c2b")):
            product = Product.objects.create(
                name=f"Ruby Saree {index}",
                slug=f"ruby-saree-{index}",
                category=category,
                gender="women",
                base_price=100,
                base_mrp=200,
            )
            ProductVariant.objects.create(
                product=product,
                sku=f"RUBY-{index}",
                price=100,
                mrp=200,
                stock_qty=4,
                color_name="Ruby",
                color_hex=hex_value,
            )

    def test_one_row_per_colour_name(self):
        rows = self.client.get("/api/catalog/facets", {"gender": "women"}).json()["colors"]
        ruby = [row for row in rows if row["color_name"] == "Ruby"]
        self.assertEqual(len(ruby), 1)

    def test_count_matches_what_filtering_by_that_colour_returns(self):
        rows = self.client.get("/api/catalog/facets", {"gender": "women"}).json()["colors"]
        ruby = next(row for row in rows if row["color_name"] == "Ruby")
        filtered = self.client.get("/api/products", {"gender": "women", "color": "Ruby"}).json()
        self.assertEqual(ruby["count"], filtered["total"])

    def test_representative_swatch_is_the_majority_hex(self):
        rows = self.client.get("/api/catalog/facets", {"gender": "women"}).json()["colors"]
        ruby = next(row for row in rows if row["color_name"] == "Ruby")
        self.assertEqual(ruby["color_hex"], "#9F1E34")


class PublicCatalogThrottleTests(TestCase):
    """Browsing the catalogue must not consume the shared anon bucket.

    Behind this ingress every anonymous visitor shares one throttle identity, so an
    "anon" bucket sized for a single client is really sized for the whole internet.
    Ordinary shopping (2+ API calls per page view) was draining it and 429'ing real
    customers while the SPA shell still served — the site looked up, the store looked
    empty. These views therefore use the far looser `catalog` scope instead.
    """

    def setUp(self):
        self.client = APIClient()
        cache.clear()

    def tearDown(self):
        cache.clear()

    def test_public_read_views_are_off_the_anon_bucket_entirely(self):
        # The mechanism, asserted directly: these views REPLACE the default throttle classes
        # rather than adding a scope alongside them. Setting only `throttle_scope` would leave
        # AnonRateThrottle attached and the shared bucket would still drain.
        from rest_framework.throttling import AnonRateThrottle

        from catalog.views import (
            CatalogFacetsView,
            CategoryListView,
            CollectionListView,
            ProductDetailView,
            ProductListView,
        )

        for view in (
            ProductListView,
            ProductDetailView,
            CategoryListView,
            CollectionListView,
            CatalogFacetsView,
        ):
            classes = view().get_throttles()
            self.assertTrue(classes, f"{view.__name__} has no throttle at all")
            self.assertFalse(
                any(isinstance(t, AnonRateThrottle) for t in classes),
                f"{view.__name__} still drains the shared anon bucket",
            )
            self.assertEqual([t.scope for t in classes], ["catalog"])

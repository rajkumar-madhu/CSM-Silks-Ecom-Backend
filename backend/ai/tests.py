from __future__ import annotations

import base64
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from catalog.models import Category, Product, ProductImage, ProductVariant

from .models import TryOnSession
from .tasks import purge_expired_tryon_photos

# 1x1 transparent PNG
PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)
PNG_B64 = base64.b64encode(PNG_BYTES).decode("ascii")


class TryOnPhotoFailureTests(TestCase):
    """A photo that cannot be saved used to fall through to the product image, so
    Replicate was billed for a run with the saree as both person and garment."""

    def setUp(self):
        self.client = APIClient()
        category = Category.objects.create(name="Silk", slug="silk-tryon")
        self.product = Product.objects.create(name="TryOn Saree", slug="tryon-saree", category=category, is_active=True)
        ProductVariant.objects.create(
            product=self.product, sku="TRYON-1", price=Decimal("1000.00"), mrp=Decimal("1200.00"), stock_qty=1
        )
        ProductImage.objects.create(
            product=self.product, image_url="/images/catalog/tryon.jpg", is_primary=True, sort_order=0
        )

    def test_unsupported_media_type_returns_400_and_never_calls_vton(self):
        with patch("ai.services.generate_virtual_tryon") as vton:
            resp = self.client.post(
                "/api/ai/tryon",
                {
                    "product_id": self.product.id,
                    "user_photo_base64": PNG_B64,
                    "user_photo_media_type": "image/heic",
                },
                format="json",
            )
        self.assertEqual(resp.status_code, 400)
        vton.assert_not_called()
        self.assertFalse(TryOnSession.objects.exists())

    def test_save_failure_returns_400_and_never_calls_vton(self):
        with patch("ai.services.save_base64_image", return_value=None), \
             patch("ai.services.generate_virtual_tryon") as vton:
            resp = self.client.post(
                "/api/ai/tryon",
                {"product_id": self.product.id, "user_photo_base64": PNG_B64, "user_photo_media_type": "image/png"},
                format="json",
            )
        self.assertEqual(resp.status_code, 400)
        vton.assert_not_called()

    def test_missing_photo_still_returns_400(self):
        resp = self.client.post("/api/ai/tryon", {"product_id": self.product.id}, format="json")
        self.assertEqual(resp.status_code, 400)


class TryOnGarmentUrlTests(TestCase):
    """ProductImage.image_url may be site-relative; Replicate and urlopen both need
    an absolute URL or every try-on for those products fails."""

    def test_relative_product_image_is_absolutised_before_vton(self):
        category = Category.objects.create(name="Silk", slug="silk-abs")
        product = Product.objects.create(name="Abs Saree", slug="abs-saree", category=category, is_active=True)
        ProductImage.objects.create(
            product=product, image_url="/images/catalog/royal.jpg", is_primary=True, sort_order=0
        )

        with patch("ai.services.generate_virtual_tryon", return_value=(None, None, 0)) as vton:
            self.client = APIClient()
            self.client.post(
                "/api/ai/tryon",
                {"product_id": product.id, "user_photo_base64": PNG_B64, "user_photo_media_type": "image/png"},
                format="json",
            )

        self.assertTrue(vton.called)
        garment = vton.call_args.kwargs["garment_image_url"]
        person = vton.call_args.kwargs["person_image_url"]
        self.assertTrue(garment.startswith("http://"), garment)
        self.assertTrue(person.startswith("http://"), person)
        self.assertNotEqual(garment, person)


@override_settings(AI_TRYON_PHOTO_RETENTION_DAYS=30)
class TryOnPhotoRetentionTests(TestCase):
    """Anonymous customers' body photos were retained indefinitely under public /media."""

    def _session(self, *, age_days: int, tmpdir: Path) -> TryOnSession:
        photo = tmpdir / "tryon" / "customers" / "shot.png"
        photo.parent.mkdir(parents=True, exist_ok=True)
        photo.write_bytes(PNG_BYTES)
        session = TryOnSession.objects.create(
            skin_tone="medium", body_type="regular", drape_style="traditional",
            customer_photo="/media/tryon/customers/shot.png",
        )
        TryOnSession.objects.filter(pk=session.pk).update(
            created_at=timezone.now() - timedelta(days=age_days)
        )
        session.refresh_from_db()
        return session

    def test_old_photos_are_deleted_and_paths_cleared(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            with override_settings(MEDIA_ROOT=str(tmpdir), MEDIA_URL="/media/"):
                session = self._session(age_days=60, tmpdir=tmpdir)
                result = purge_expired_tryon_photos()

                self.assertEqual(result["deleted_files"], 1)
                self.assertFalse((tmpdir / "tryon" / "customers" / "shot.png").exists())
                session.refresh_from_db()
                self.assertEqual(session.customer_photo, "")

    def test_recent_photos_are_kept(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            with override_settings(MEDIA_ROOT=str(tmpdir), MEDIA_URL="/media/"):
                session = self._session(age_days=1, tmpdir=tmpdir)
                result = purge_expired_tryon_photos()

                self.assertEqual(result["deleted_files"], 0)
                self.assertTrue((tmpdir / "tryon" / "customers" / "shot.png").exists())
                session.refresh_from_db()
                self.assertEqual(session.customer_photo, "/media/tryon/customers/shot.png")

    def test_path_traversal_is_refused(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            outside = tmpdir.parent / "outside-secret.txt"
            outside.write_text("keep me")
            with override_settings(MEDIA_ROOT=str(tmpdir), MEDIA_URL="/media/"):
                session = TryOnSession.objects.create(
                    skin_tone="medium", body_type="regular", drape_style="traditional",
                    customer_photo="/media/../outside-secret.txt",
                )
                TryOnSession.objects.filter(pk=session.pk).update(
                    created_at=timezone.now() - timedelta(days=60)
                )
                purge_expired_tryon_photos()

            self.assertTrue(outside.exists(), "must never unlink outside MEDIA_ROOT")
            outside.unlink()

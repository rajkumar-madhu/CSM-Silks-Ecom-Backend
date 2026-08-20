import json
import tempfile
from pathlib import Path

from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient


class ReadinessEndpointTests(TestCase):
    @override_settings(
        DEBUG=True,
        APP_ENV="test",
        CHANNEL_LAYER_BACKEND="redis",
        REDIS_URL="redis://redis:6379/0",
        CELERY_BROKER_URL="redis://redis:6379/0",
        RAZORPAY_KEY_ID="rzp_test_ready",
        RAZORPAY_KEY_SECRET="razorpay-secret",
        RAZORPAY_WEBHOOK_SECRET="razorpay-webhook-secret",
        SMS_OTP_ENABLED=False,
        OTP_EMAIL_ENABLED=True,
        RESEND_API_KEY="resend-secret",
        RESEND_FROM_EMAIL="orders@csmsilks.example.com",
        NOTIFICATION_EMAIL_ENABLED=True,
        WHATSAPP_ENABLED=False,
        DEFAULT_COURIER_PROVIDER="manual",
        OTP_DEV_FALLBACK_ENABLED=False,
        PAYMENT_DEV_FALLBACK_ENABLED=False,
    )
    def test_readiness_reports_ready_without_secret_values(self):
        response = APIClient().get("/api/readiness")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "ready")
        self.assertTrue(all(check["ok"] for check in body["checks"].values()))
        rendered = json.dumps(body)
        self.assertNotIn("razorpay-secret", rendered)
        self.assertNotIn("resend-secret", rendered)

    @override_settings(
        DEBUG=True,
        APP_ENV="test",
        CHANNEL_LAYER_BACKEND="memory",
        REDIS_URL="",
        CELERY_BROKER_URL="",
        RAZORPAY_KEY_ID="",
        RAZORPAY_KEY_SECRET="",
        RAZORPAY_WEBHOOK_SECRET="",
        SMS_OTP_ENABLED=False,
        OTP_EMAIL_ENABLED=False,
        NOTIFICATION_EMAIL_ENABLED=False,
        WHATSAPP_ENABLED=False,
        DEFAULT_COURIER_PROVIDER="shiprocket",
        SHIPROCKET_EMAIL="",
        SHIPROCKET_PASSWORD="",
        SHIPROCKET_WEBHOOK_SECRET="",
    )
    def test_readiness_reports_degraded_when_live_services_are_missing(self):
        response = APIClient().get("/api/readiness")

        self.assertEqual(response.status_code, 503)
        checks = response.json()["checks"]
        self.assertFalse(checks["realtime"]["ok"])
        self.assertFalse(checks["payments"]["ok"])
        self.assertFalse(checks["otp"]["ok"])
        self.assertFalse(checks["notifications"]["ok"])
        self.assertFalse(checks["shipping"]["ok"])


class MediaServingTests(SimpleTestCase):
    def test_media_is_served_when_debug_is_false(self):
        with tempfile.TemporaryDirectory() as tmp:
            media_root = Path(tmp)
            payload = b"silk-media-ok"
            (media_root / "probe.txt").write_bytes(payload)

            with override_settings(DEBUG=False, SECURE_SSL_REDIRECT=False, MEDIA_ROOT=media_root):
                response = APIClient().get("/media/probe.txt")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(b"".join(response.streaming_content), payload)

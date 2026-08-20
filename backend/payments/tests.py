from pathlib import Path
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from analytics.models import AdminAuditLog
from notifications.models import Notification
from orders.models import Order
from shipping.models import ShipmentEvent
from .models import Payment, RazorpayWebhookEvent
from payments.services import verify_payment_signature

User = get_user_model()


class PaymentProductionGuardTests(SimpleTestCase):
    def test_dev_signature_is_rejected_without_explicit_dev_fallback(self):
        with override_settings(DEBUG=True, PAYMENT_DEV_FALLBACK_ENABLED=False, RAZORPAY_KEY_SECRET=""):
            self.assertFalse(verify_payment_signature("order_dev_guard", "pay_dev_guard", "dev"))

    def test_frontend_does_not_fake_razorpay_success(self):
        root = Path(__file__).resolve().parents[2]
        checkout_source = (root / "frontend" / "src" / "pages" / "Checkout.tsx").read_text(encoding="utf-8")
        orders_source = (root / "frontend" / "src" / "pages" / "Orders.tsx").read_text(encoding="utf-8")

        combined_source = checkout_source + "\n" + orders_source
        self.assertNotIn("razorpay_signature: 'dev'", combined_source)
        self.assertNotIn("pay_dev_", combined_source)
        self.assertNotIn("pay_retry_", combined_source)


@override_settings(DEBUG=True, PAYMENT_DEV_FALLBACK_ENABLED=True, RAZORPAY_KEY_ID="", RAZORPAY_KEY_SECRET="", RAZORPAY_WEBHOOK_SECRET="")
class PaymentRefundApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="+919900000001", phone="+919900000001", password="customer123", is_verified=True)
        self.admin = User.objects.create_user(username="refund-admin", email="refund-admin@example.com", password="admin123", is_staff=True)
        self.client.force_authenticate(self.admin)

    def create_paid_order(self, *, status=Order.Status.DELIVERED, payment_status=Payment.Status.CAPTURED, amount=Decimal("100.00")):
        order = Order.objects.create(
            order_number=f"CSM-REF-{Order.objects.count() + 1}",
            user=self.user,
            subtotal=amount,
            total_amount=amount,
            status=status,
            payment_method=Order.PaymentMethod.RAZORPAY,
            delivered_at=timezone.now() if status == Order.Status.DELIVERED else None,
        )
        payment = Payment.objects.create(
            order=order,
            amount=amount,
            method=Payment.Method.CARD,
            status=payment_status,
            razorpay_payment_id=f"pay_refund_{order.id}",
            razorpay_order_id=f"order_refund_{order.id}",
            paid_at=timezone.now() if payment_status == Payment.Status.CAPTURED else None,
        )
        return order, payment

    def test_admin_refund_rejects_uncaptured_payment(self):
        order, payment = self.create_paid_order(payment_status=Payment.Status.PENDING)

        resp = self.client.post("/api/payments/refund", {"order_id": order.id, "amount": "25.00"}, format="json")

        self.assertEqual(resp.status_code, 400)
        self.assertIn("captured", resp.json()["detail"].lower())
        payment.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(payment.status, Payment.Status.PENDING)
        self.assertEqual(payment.refunded_amount, Decimal("0.00"))
        self.assertEqual(order.status, Order.Status.DELIVERED)
        self.assertTrue(AdminAuditLog.objects.filter(action="payment.refund_rejected", entity_id=str(payment.id)).exists())

    def test_partial_refund_does_not_mark_order_refunded(self):
        order, payment = self.create_paid_order()

        resp = self.client.post("/api/payments/refund", {"order_id": order.id, "amount": "40.00"}, format="json")

        self.assertEqual(resp.status_code, 200)
        payment.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(payment.status, Payment.Status.PARTIALLY_REFUNDED)
        self.assertEqual(payment.refunded_amount, Decimal("40.00"))
        self.assertEqual(order.status, Order.Status.DELIVERED)
        self.assertTrue(ShipmentEvent.objects.filter(order=order, status=ShipmentEvent.Status.REFUNDED, description__icontains="Partial refund").exists())
        self.assertTrue(Notification.objects.filter(user=self.user, title__icontains="refund").exists())
        self.assertTrue(AdminAuditLog.objects.filter(action="payment.refund", entity_id=str(payment.id), metadata__refund_status=Payment.Status.PARTIALLY_REFUNDED).exists())

    def test_refund_cannot_exceed_remaining_amount(self):
        order, payment = self.create_paid_order()
        payment.refunded_amount = Decimal("80.00")
        payment.status = Payment.Status.PARTIALLY_REFUNDED
        payment.refund_id = "rfnd_existing"
        payment.save(update_fields=["refunded_amount", "status", "refund_id", "updated_at"])

        resp = self.client.post("/api/payments/refund", {"order_id": order.id, "amount": "30.00"}, format="json")

        self.assertEqual(resp.status_code, 400)
        self.assertIn("remaining", resp.json()["detail"].lower())
        payment.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(payment.refunded_amount, Decimal("80.00"))
        self.assertEqual(payment.status, Payment.Status.PARTIALLY_REFUNDED)
        self.assertEqual(order.status, Order.Status.DELIVERED)

    def test_refund_webhook_reconciles_refund_once(self):
        order, payment = self.create_paid_order()
        public_client = APIClient()
        payload = {
            "id": "evt_refund_processed_1",
            "event": "refund.processed",
            "payload": {
                "refund": {
                    "entity": {
                        "id": "rfnd_webhook_1",
                        "payment_id": payment.razorpay_payment_id,
                        "amount": 4000,
                        "status": "processed",
                    }
                }
            },
        }

        first = public_client.post("/api/payments/webhook", payload, format="json", HTTP_X_RAZORPAY_SIGNATURE="dev")
        duplicate = public_client.post("/api/payments/webhook", payload, format="json", HTTP_X_RAZORPAY_SIGNATURE="dev")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(duplicate.status_code, 200)
        payment.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(payment.status, Payment.Status.PARTIALLY_REFUNDED)
        self.assertEqual(payment.refunded_amount, Decimal("40.00"))
        self.assertEqual(order.status, Order.Status.DELIVERED)
        self.assertEqual(RazorpayWebhookEvent.objects.get(event_id="evt_refund_processed_1").processed_at is not None, True)
        self.assertEqual(ShipmentEvent.objects.filter(order=order, status=ShipmentEvent.Status.REFUNDED, description__icontains="Partial refund").count(), 1)


@override_settings(DEBUG=True, PAYMENT_DEV_FALLBACK_ENABLED=True, RAZORPAY_KEY_ID="", RAZORPAY_KEY_SECRET="", RAZORPAY_WEBHOOK_SECRET="")
class PaymentLookupRegressionTests(TestCase):
    """Unknown ids used to raise DoesNotExist straight out of the view as a 500."""

    def setUp(self):
        self.user = User.objects.create_user(username="+919900000501", email="lookup1@example.com", phone="+919900000501", password="customer123", is_verified=True)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_razorpay_order_for_unknown_order_id_returns_404(self):
        resp = self.client.post("/api/payments/razorpay/order", {"order_id": 999999}, format="json")
        self.assertEqual(resp.status_code, 404)

    def test_razorpay_order_for_another_users_order_returns_404(self):
        other = User.objects.create_user(username="+919900000502", email="lookup2@example.com", phone="+919900000502", password="customer123")
        order = Order.objects.create(
            order_number="CSM-OTHER-1", user=other, subtotal=Decimal("100.00"),
            total_amount=Decimal("100.00"), status=Order.Status.PAYMENT_PENDING,
            payment_method=Order.PaymentMethod.RAZORPAY,
        )
        resp = self.client.post("/api/payments/razorpay/order", {"order_id": order.id}, format="json")
        self.assertEqual(resp.status_code, 404)

    def test_verify_with_unknown_razorpay_order_id_returns_404(self):
        resp = self.client.post(
            "/api/payments/razorpay/verify",
            {"razorpay_order_id": "order_nope", "razorpay_payment_id": "pay_x", "razorpay_signature": "dev"},
            format="json",
        )
        self.assertEqual(resp.status_code, 404)


@override_settings(DEBUG=True, PAYMENT_DEV_FALLBACK_ENABLED=True, RAZORPAY_KEY_ID="", RAZORPAY_KEY_SECRET="", RAZORPAY_WEBHOOK_SECRET="")
class RefundAmountGuardTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="+919900000601", email="guard1@example.com", phone="+919900000601", password="customer123", is_verified=True)
        self.admin = User.objects.create_user(username="guard-admin", email="guard-admin@example.com", password="admin123", is_staff=True)
        self.client.force_authenticate(self.admin)
        self.order = Order.objects.create(
            order_number="CSM-GUARD-1", user=self.user, subtotal=Decimal("100.00"),
            total_amount=Decimal("100.00"), status=Order.Status.DELIVERED,
            payment_method=Order.PaymentMethod.COD,
        )
        self.payment = Payment.objects.create(
            order=self.order, amount=Decimal("100.00"), method=Payment.Method.COD,
            status=Payment.Status.CAPTURED, paid_at=timezone.now(),
        )

    def test_zero_amount_is_rejected_not_treated_as_full_refund(self):
        resp = self.client.post("/api/payments/refund", {"order_id": self.order.id, "amount": "0.00"}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.refunded_amount, Decimal("0.00"))
        self.assertEqual(self.payment.status, Payment.Status.CAPTURED)

    def test_negative_amount_is_rejected(self):
        resp = self.client.post("/api/payments/refund", {"order_id": self.order.id, "amount": "-10.00"}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.refunded_amount, Decimal("0.00"))

    def test_over_refund_is_rejected_before_any_state_change(self):
        resp = self.client.post("/api/payments/refund", {"order_id": self.order.id, "amount": "150.00"}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.refunded_amount, Decimal("0.00"))

    def test_omitted_amount_still_refunds_remaining_balance(self):
        resp = self.client.post("/api/payments/refund", {"order_id": self.order.id}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.refunded_amount, Decimal("100.00"))
        self.assertEqual(self.payment.status, Payment.Status.REFUNDED)

    def test_refund_for_unknown_order_returns_404(self):
        resp = self.client.post("/api/payments/refund", {"order_id": 987654}, format="json")
        self.assertEqual(resp.status_code, 404)

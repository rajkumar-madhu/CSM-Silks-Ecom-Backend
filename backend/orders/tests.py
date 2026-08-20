from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Address
from analytics.models import AdminAuditLog
from catalog.models import Category, Product, ProductVariant
from inventory.models import StockLedger, StockReservation
from loyalty.models import LoyaltyTransaction
from notifications.models import Notification
from datetime import timedelta

from orders.pricing import calculate_coupon_discount, calculate_gst, calculate_loyalty_points
from django.db.models import F

from orders.models import Coupon, Order, OrderItem, ReturnRequest
from orders.services import _restock_order_items, _restock_variant
from orders.views import render_invoice_html
from payments.models import Payment
from shipping.models import Shipment, ShipmentEvent

User = get_user_model()


class _FakeChannelLayer:
    def __init__(self):
        self.messages = []

    async def group_send(self, group, message):
        self.messages.append((group, message))


@override_settings(DEBUG=True, RAZORPAY_KEY_ID="", RAZORPAY_KEY_SECRET="", RAZORPAY_WEBHOOK_SECRET="", PAYMENT_DEV_FALLBACK_ENABLED=True)
class CheckoutFlowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="+918888888888", phone="+918888888888", password="customer123", is_verified=True)
        self.client.force_authenticate(self.user)
        self.address = Address.objects.create(
            user=self.user,
            full_name="Test Customer",
            phone="+918888888888",
            address_line_1="12 Silk Street",
            city="Kanchipuram",
            state="Tamil Nadu",
            pin_code="631501",
        )
        category = Category.objects.create(name="Kanjivaram", slug="kanjivaram", gender="women")
        self.product = Product.objects.create(name="Royal Kanjivaram", slug="royal-kanjivaram", category=category, gender="women", base_price=Decimal("1000"), base_mrp=Decimal("1200"))
        self.variant = ProductVariant.objects.create(product=self.product, sku="CSM-KJ-TEST", color_name="Gold", color_hex="#C4923A", price=Decimal("1000"), mrp=Decimal("1200"), stock_qty=2)

    def test_gst_and_loyalty_math(self):
        cgst, sgst = calculate_gst(Decimal("10000"))
        self.assertEqual(cgst, Decimal("250.00"))
        self.assertEqual(sgst, Decimal("250.00"))
        self.assertEqual(calculate_loyalty_points(Decimal("1000")), 50)

    def test_cod_checkout_reduces_stock_and_creates_order(self):
        add_resp = self.client.post("/api/cart", {"variant_id": self.variant.id, "quantity": 1}, format="json")
        self.assertEqual(add_resp.status_code, 200)

        order_resp = self.client.post(
            "/api/orders",
            {"address_id": self.address.id, "payment_method": "cod"},
            format="json",
        )
        self.assertEqual(order_resp.status_code, 201)
        body = order_resp.json()
        self.assertEqual(body["status"], "confirmed")
        self.assertEqual(len(body["items"]), 1)
        self.assertTrue(ShipmentEvent.objects.filter(order_id=body["id"], status=ShipmentEvent.Status.ORDER_PLACED).exists())

        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_qty, 1)

        cart_resp = self.client.get("/api/cart")
        self.assertEqual(cart_resp.json()["item_count"], 0)

    def test_checkout_applies_blouse_stitch_fall_pico_and_occasion_note(self):
        cart = self.client.post("/api/cart", {"variant_id": self.variant.id, "quantity": 1}, format="json")
        item_id = cart.json()["items"][0]["id"]
        order_resp = self.client.post(
            "/api/orders",
            {
                "address_id": self.address.id,
                "payment_method": "cod",
                "occasion_note": "Daughter's wedding, pack as bridal",
                "finishing": [{
                    "cart_item_id": item_id,
                    "blouse_stitching": True,
                    "blouse_size": "36",
                    "fall_pico": True,
                }],
            },
            format="json",
        )
        self.assertEqual(order_resp.status_code, 201)
        body = order_resp.json()
        self.assertEqual(body["occasion_note"], "Daughter's wedding, pack as bridal")
        self.assertEqual(Decimal(body["finishing_amount"]), Decimal("500.00"))
        line = body["items"][0]
        self.assertTrue(line["blouse_stitching"])
        self.assertEqual(line["blouse_size"], "36")
        self.assertTrue(line["fall_pico"])

    def test_checkout_requires_blouse_size_when_stitching(self):
        cart = self.client.post("/api/cart", {"variant_id": self.variant.id, "quantity": 1}, format="json")
        item_id = cart.json()["items"][0]["id"]
        order_resp = self.client.post(
            "/api/orders",
            {
                "address_id": self.address.id,
                "payment_method": "cod",
                "finishing": [{"cart_item_id": item_id, "blouse_stitching": True, "blouse_size": "", "fall_pico": False}],
            },
            format="json",
        )
        self.assertEqual(order_resp.status_code, 400)
        self.assertIn("blouse size", order_resp.json()["detail"].lower())

    def test_checkout_rejects_incomplete_saved_address(self):
        incomplete = Address.objects.create(
            user=self.user,
            full_name="Incomplete Customer",
            phone="",
            address_line_1="",
            city="",
            state="",
            pin_code="",
        )
        self.client.post("/api/cart", {"variant_id": self.variant.id, "quantity": 1}, format="json")

        order_resp = self.client.post(
            "/api/orders",
            {"address_id": incomplete.id, "payment_method": "cod"},
            format="json",
        )

        self.assertEqual(order_resp.status_code, 400)
        self.assertIn("incomplete", order_resp.json()["detail"].lower())
        self.assertEqual(Order.objects.count(), 0)

    def test_customer_order_history_is_paginated_for_realtime_screen_scope(self):
        for index in range(5):
            Order.objects.create(
                order_number=f"CSM-PAGE-CUST-{index}",
                user=self.user,
                address=self.address,
                subtotal=Decimal("100.00"),
                total_amount=Decimal("100.00"),
                status=Order.Status.CONFIRMED,
                payment_method=Order.PaymentMethod.COD,
            )

        response = self.client.get("/api/orders?page=2&per_page=2")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body["items"]), 2)
        self.assertEqual(body["total"], 5)
        self.assertEqual(body["page"], 2)
        self.assertEqual(body["per_page"], 2)
        self.assertEqual(body["pages"], 3)

    def test_admin_order_list_is_paginated_and_status_filter_preserves_metadata(self):
        for index in range(5):
            Order.objects.create(
                order_number=f"CSM-PAGE-ADMIN-{index}",
                user=self.user,
                address=self.address,
                subtotal=Decimal("100.00"),
                total_amount=Decimal("100.00"),
                status=Order.Status.DELIVERED if index < 3 else Order.Status.CONFIRMED,
                payment_method=Order.PaymentMethod.COD,
            )
        admin = User.objects.create_user(username="page-admin", email="page-admin@example.com", password="admin123", is_staff=True)
        self.client.force_authenticate(admin)

        response = self.client.get(f"/api/admin/orders?status={Order.Status.DELIVERED}&page=2&per_page=2")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body["items"]), 1)
        self.assertEqual(body["total"], 3)
        self.assertEqual(body["page"], 2)
        self.assertEqual(body["per_page"], 2)
        self.assertEqual(body["pages"], 2)

    def test_prepaid_payment_confirms_order_and_releases_stock_reservation(self):
        self.client.post("/api/cart", {"variant_id": self.variant.id, "quantity": 1}, format="json")
        order_resp = self.client.post(
            "/api/orders",
            {"address_id": self.address.id, "payment_method": "razorpay"},
            format="json",
        )
        self.assertEqual(order_resp.status_code, 201)
        order_id = order_resp.json()["id"]
        self.assertEqual(order_resp.json()["status"], "payment_pending")
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.reserved_qty, 1)

        gateway_resp = self.client.post("/api/payments/razorpay/order", {"order_id": order_id}, format="json")
        self.assertEqual(gateway_resp.status_code, 200)
        verify_resp = self.client.post(
            "/api/payments/razorpay/verify",
            {
                "razorpay_order_id": gateway_resp.json()["razorpay_order_id"],
                "razorpay_payment_id": "pay_test_123",
                "razorpay_signature": "dev",
            },
            format="json",
        )
        self.assertEqual(verify_resp.status_code, 200)

        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_qty, 1)
        self.assertEqual(self.variant.reserved_qty, 0)
        self.assertFalse(StockReservation.objects.filter(order_number=Order.objects.get(id=order_id).order_number, released_at__isnull=True).exists())

    def test_cancel_payment_pending_order_releases_stock_reservation(self):
        self.client.post("/api/cart", {"variant_id": self.variant.id, "quantity": 1}, format="json")
        order_resp = self.client.post(
            "/api/orders",
            {"address_id": self.address.id, "payment_method": "razorpay"},
            format="json",
        )
        self.assertEqual(order_resp.status_code, 201)
        order_id = order_resp.json()["id"]
        order_number = order_resp.json()["order_number"]
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_qty, 2)
        self.assertEqual(self.variant.reserved_qty, 1)
        self.assertTrue(StockReservation.objects.filter(order_number=order_number, released_at__isnull=True).exists())

        cancel_resp = self.client.post(f"/api/orders/{order_id}/cancel", {}, format="json")

        self.assertEqual(cancel_resp.status_code, 200)
        self.assertEqual(cancel_resp.json()["status"], Order.Status.CANCELLED)
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_qty, 2)
        self.assertEqual(self.variant.reserved_qty, 0)
        self.assertFalse(StockReservation.objects.filter(order_number=order_number, released_at__isnull=True).exists())
        self.assertTrue(StockLedger.objects.filter(variant=self.variant, reason=StockLedger.Reason.RELEASE, reference=order_number, quantity_delta=1).exists())
        self.assertTrue(ShipmentEvent.objects.filter(order_id=order_id, status=ShipmentEvent.Status.CANCELLED).exists())

    def test_cancel_confirmed_cod_order_restocks_and_rolls_back_loyalty_coupon(self):
        self.user.loyalty_points = 100
        self.user.save(update_fields=["loyalty_points"])
        coupon = Coupon.objects.create(code="SAVE10", discount_type=Coupon.DiscountType.FLAT, value=Decimal("10.00"))
        self.client.post("/api/cart", {"variant_id": self.variant.id, "quantity": 1}, format="json")
        self.client.post("/api/cart/coupon", {"coupon_code": coupon.code}, format="json")
        order_resp = self.client.post(
            "/api/orders",
            {"address_id": self.address.id, "payment_method": "cod", "loyalty_points_to_use": 20},
            format="json",
        )
        self.assertEqual(order_resp.status_code, 201)
        order_id = order_resp.json()["id"]
        order = Order.objects.get(id=order_id)
        self.variant.refresh_from_db()
        self.product.refresh_from_db()
        coupon.refresh_from_db()
        self.user.refresh_from_db()
        self.assertEqual(order.status, Order.Status.CONFIRMED)
        self.assertEqual(self.variant.stock_qty, 1)
        self.assertEqual(self.product.total_sold, 1)
        self.assertEqual(coupon.used_count, 1)
        self.assertEqual(self.user.loyalty_points, 100 - order.loyalty_points_used + order.loyalty_points_earned)

        cancel_resp = self.client.post(f"/api/orders/{order_id}/cancel", {}, format="json")

        self.assertEqual(cancel_resp.status_code, 200)
        self.assertEqual(cancel_resp.json()["status"], Order.Status.CANCELLED)
        self.variant.refresh_from_db()
        self.product.refresh_from_db()
        coupon.refresh_from_db()
        self.user.refresh_from_db()
        self.assertEqual(self.variant.stock_qty, 2)
        self.assertEqual(self.variant.reserved_qty, 0)
        self.assertEqual(self.product.total_sold, 0)
        self.assertEqual(coupon.used_count, 0)
        self.assertEqual(self.user.loyalty_points, 100)
        self.assertTrue(StockLedger.objects.filter(variant=self.variant, reason=StockLedger.Reason.RETURN, reference=order.order_number, quantity_delta=1).exists())
        self.assertTrue(LoyaltyTransaction.objects.filter(user=self.user, order_id=order.id, description__icontains="cancelled").exists())

    def test_admin_cancel_uses_same_inventory_lifecycle(self):
        self.client.post("/api/cart", {"variant_id": self.variant.id, "quantity": 1}, format="json")
        order_resp = self.client.post("/api/orders", {"address_id": self.address.id, "payment_method": "cod"}, format="json")
        order_id = order_resp.json()["id"]
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_qty, 1)
        admin = User.objects.create_user(username="cancel-admin", email="cancel@example.com", password="admin123", is_staff=True)
        self.client.force_authenticate(admin)

        cancel_resp = self.client.post(
            f"/api/admin/orders/{order_id}/workflow",
            {"action": "cancel", "note": "Customer requested cancellation before packing.", "location": "Kanchipuram store"},
            format="json",
        )

        self.assertEqual(cancel_resp.status_code, 200)
        self.assertEqual(cancel_resp.json()["status"], Order.Status.CANCELLED)
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_qty, 2)
        self.assertTrue(ShipmentEvent.objects.filter(order_id=order_id, status=ShipmentEvent.Status.CANCELLED, location="Kanchipuram store").exists())

    def test_admin_cannot_confirm_unpaid_razorpay_order(self):
        self.client.post("/api/cart", {"variant_id": self.variant.id, "quantity": 1}, format="json")
        order_resp = self.client.post("/api/orders", {"address_id": self.address.id, "payment_method": "razorpay"}, format="json")
        self.assertEqual(order_resp.status_code, 201)
        order_id = order_resp.json()["id"]
        admin = User.objects.create_user(username="unpaid-admin", email="unpaid@example.com", password="admin123", is_staff=True)
        self.client.force_authenticate(admin)

        confirm_resp = self.client.post(
            f"/api/admin/orders/{order_id}/workflow",
            {"action": "confirm", "note": "Manual confirmation attempt."},
            format="json",
        )

        self.assertEqual(confirm_resp.status_code, 400)
        self.assertIn("payment", confirm_resp.json()["detail"].lower())
        order = Order.objects.get(id=order_id)
        self.assertEqual(order.status, Order.Status.PAYMENT_PENDING)
        self.assertEqual(order.payment.status, Payment.Status.PENDING)
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_qty, 2)
        self.assertEqual(self.variant.reserved_qty, 1)

    def test_admin_cannot_create_label_for_unpaid_razorpay_order(self):
        self.client.post("/api/cart", {"variant_id": self.variant.id, "quantity": 1}, format="json")
        order_resp = self.client.post("/api/orders", {"address_id": self.address.id, "payment_method": "razorpay"}, format="json")
        self.assertEqual(order_resp.status_code, 201)
        order_id = order_resp.json()["id"]
        admin = User.objects.create_user(username="label-admin", email="label@example.com", password="admin123", is_staff=True)
        self.client.force_authenticate(admin)

        label_resp = self.client.post(
            f"/api/admin/orders/{order_id}/workflow",
            {"action": "create_label", "provider": "manual"},
            format="json",
        )

        self.assertEqual(label_resp.status_code, 400)
        self.assertIn("payment", label_resp.json()["detail"].lower())
        self.assertFalse(Shipment.objects.filter(order_id=order_id).exists())
        order = Order.objects.get(id=order_id)
        self.assertEqual(order.status, Order.Status.PAYMENT_PENDING)

    @override_settings(DEBUG=True, RAZORPAY_KEY_ID="", RAZORPAY_KEY_SECRET="", PAYMENT_DEV_FALLBACK_ENABLED=False)
    def test_prepaid_checkout_requires_gateway_before_creating_order(self):
        self.client.post("/api/cart", {"variant_id": self.variant.id, "quantity": 1}, format="json")

        order_resp = self.client.post(
            "/api/orders",
            {"address_id": self.address.id, "payment_method": "razorpay"},
            format="json",
        )

        self.assertEqual(order_resp.status_code, 503)
        self.assertEqual(Order.objects.count(), 0)
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_qty, 2)
        self.assertEqual(self.variant.reserved_qty, 0)
        self.assertEqual(self.client.get("/api/cart").json()["item_count"], 1)

    def test_admin_shipment_marks_order_delivered_and_notifies_customer(self):
        self.client.post("/api/cart", {"variant_id": self.variant.id, "quantity": 1}, format="json")
        order_resp = self.client.post("/api/orders", {"address_id": self.address.id, "payment_method": "cod"}, format="json")
        order_id = order_resp.json()["id"]
        admin = User.objects.create_user(username="admin", email="admin@example.com", password="admin123", is_staff=True)
        self.client.force_authenticate(admin)

        shipment_resp = self.client.post(
            "/api/admin/shipments",
            {
                "order": order_id,
                "provider": "manual",
                "awb_number": "AWB123",
                "tracking_url": "https://track.example.com/AWB123",
                "status": "delivered",
                "event_location": "Kanchipuram hub",
                "event_note": "Delivered to customer.",
            },
            format="json",
        )
        self.assertEqual(shipment_resp.status_code, 201)
        order = Order.objects.get(id=order_id)
        self.assertEqual(order.status, Order.Status.DELIVERED)
        self.assertEqual(order.tracking_number, "AWB123")
        self.assertTrue(ShipmentEvent.objects.filter(order=order, status=ShipmentEvent.Status.DELIVERED, location="Kanchipuram hub").exists())
        self.assertTrue(Notification.objects.filter(user=self.user, notification_type="shipping").exists())

        detail_resp = self.client.get(f"/api/admin/orders?status={Order.Status.DELIVERED}")
        tracking_events = detail_resp.json()["items"][0]["tracking_events"]
        self.assertTrue(any(event["status"] == ShipmentEvent.Status.DELIVERED for event in tracking_events))

    def test_admin_shipment_publishes_realtime_order_update(self):
        from unittest.mock import patch

        self.client.post("/api/cart", {"variant_id": self.variant.id, "quantity": 1}, format="json")
        order_resp = self.client.post("/api/orders", {"address_id": self.address.id, "payment_method": "cod"}, format="json")
        order_id = order_resp.json()["id"]
        admin = User.objects.create_user(username="realtime-admin", email="realtime-admin@example.com", password="admin123", is_staff=True)
        self.client.force_authenticate(admin)
        channel_layer = _FakeChannelLayer()

        with patch("orders.realtime.get_channel_layer", return_value=channel_layer):
            response = self.client.post(
                "/api/admin/shipments",
                {
                    "order": order_id,
                    "provider": "manual",
                    "awb_number": "LIVE-AWB-1",
                    "status": "out_for_delivery",
                    "event_location": "Chennai last-mile hub",
                    "event_note": "Package is with delivery partner.",
                },
                format="json",
            )

        self.assertEqual(response.status_code, 201)
        groups = {group for group, _message in channel_layer.messages}
        self.assertIn(f"orders_user_{self.user.id}", groups)
        self.assertIn(f"orders_order_{order_id}", groups)
        self.assertIn("orders_admin", groups)
        payloads = [message["payload"] for _group, message in channel_layer.messages]
        self.assertTrue(any(payload["type"] == "order.update" and payload["event"]["status"] == ShipmentEvent.Status.OUT_FOR_DELIVERY for payload in payloads))

    def test_public_tracking_lookup_requires_order_or_awb_and_phone_match(self):
        self.client.post("/api/cart", {"variant_id": self.variant.id, "quantity": 1}, format="json")
        order_resp = self.client.post("/api/orders", {"address_id": self.address.id, "payment_method": "cod"}, format="json")
        order_id = order_resp.json()["id"]
        admin = User.objects.create_user(username="shipment-admin", email="ship@example.com", password="admin123", is_staff=True)
        self.client.force_authenticate(admin)
        self.client.post(
            "/api/admin/shipments",
            {
                "order": order_id,
                "provider": "manual",
                "awb_number": "AWB-PUBLIC-1",
                "tracking_url": "https://track.example.com/AWB-PUBLIC-1",
                "status": "in_transit",
            },
            format="json",
        )

        public_client = APIClient()
        by_order = public_client.get(f"/api/orders/track?identifier={order_resp.json()['order_number']}&phone=+918888888888")
        self.assertEqual(by_order.status_code, 200)
        self.assertEqual(by_order.json()["tracking_number"], "AWB-PUBLIC-1")
        self.assertTrue(any(event["status"] == ShipmentEvent.Status.IN_TRANSIT for event in by_order.json()["tracking_events"]))

        wrong_phone = public_client.get(f"/api/orders/track?identifier=AWB-PUBLIC-1&phone=+919999999999")
        self.assertEqual(wrong_phone.status_code, 404)

    def test_admin_workflow_creates_label_and_handles_rto(self):
        self.client.post("/api/cart", {"variant_id": self.variant.id, "quantity": 1}, format="json")
        order_resp = self.client.post("/api/orders", {"address_id": self.address.id, "payment_method": "cod"}, format="json")
        order_id = order_resp.json()["id"]
        admin = User.objects.create_user(username="workflow-admin", email="workflow@example.com", password="admin123", is_staff=True)
        self.client.force_authenticate(admin)

        label_resp = self.client.post(
            f"/api/admin/orders/{order_id}/workflow",
            {"action": "create_label", "provider": "manual"},
            format="json",
        )
        self.assertEqual(label_resp.status_code, 200)
        self.assertEqual(label_resp.json()["status"], Order.Status.PACKED)
        order = Order.objects.get(id=order_id)
        self.assertTrue(order.tracking_number.startswith("CSM"))
        self.assertTrue(order.shipment.label_url)
        self.assertEqual(order.courier_url, "")
        self.assertEqual(order.shipment.tracking_url, "")
        self.assertTrue(AdminAuditLog.objects.filter(action="order.create_label", entity_id=str(order.id)).exists())

        rto_resp = self.client.post(
            f"/api/admin/orders/{order_id}/workflow",
            {"action": "rto_initiated", "note": "Customer refused delivery", "location": "Chennai hub"},
            format="json",
        )
        self.assertEqual(rto_resp.status_code, 200)
        self.assertEqual(rto_resp.json()["status"], Order.Status.RTO_INITIATED)
        self.assertTrue(ShipmentEvent.objects.filter(order_id=order_id, status=ShipmentEvent.Status.RTO_INITIATED, location="Chennai hub").exists())

        label_download = self.client.get(f"/api/admin/shipments/{order.shipment.id}/label")
        self.assertEqual(label_download.status_code, 200)
        self.assertIn(order.order_number, label_download.content.decode())

    @override_settings(STORE_CONTACT_EMAIL="orders@csmsilks.com")
    def test_shiprocket_payload_uses_store_contact_email_instead_of_local_placeholder(self):
        from shipping.shiprocket import build_order_payload

        self.client.post("/api/cart", {"variant_id": self.variant.id, "quantity": 1}, format="json")
        order_resp = self.client.post("/api/orders", {"address_id": self.address.id, "payment_method": "cod"}, format="json")
        order = Order.objects.prefetch_related("items").get(id=order_resp.json()["id"])

        payload = build_order_payload(order)

        self.assertEqual(payload["billing_email"], "orders@csmsilks.com")
        self.assertNotIn(".local", payload["billing_email"])

    @override_settings(SHIPROCKET_WEBHOOK_SECRET="testsecret")
    def test_courier_webhook_updates_tracking_and_ignores_duplicate_event(self):
        self.client.post("/api/cart", {"variant_id": self.variant.id, "quantity": 1}, format="json")
        order_resp = self.client.post("/api/orders", {"address_id": self.address.id, "payment_method": "cod"}, format="json")
        order_id = order_resp.json()["id"]
        admin = User.objects.create_user(username="webhook-admin", email="webhook@example.com", password="admin123", is_staff=True)
        self.client.force_authenticate(admin)
        self.client.post(
            f"/api/admin/orders/{order_id}/workflow",
            {"action": "create_label", "provider": "manual"},
            format="json",
        )
        order = Order.objects.get(id=order_id)
        awb = order.shipment.awb_number

        public_client = APIClient()
        payload = {
            "awb_code": awb,
            "current_status": "Out For Delivery",
            "location": "Chennai last-mile hub",
            "remarks": "Package is with delivery partner.",
        }
        webhook_resp = public_client.post("/api/shipping/webhook", payload, format="json", HTTP_X_SHIPROCKET_WEBHOOK_SECRET="testsecret")
        self.assertEqual(webhook_resp.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.OUT_FOR_DELIVERY)
        self.assertTrue(ShipmentEvent.objects.filter(order=order, status=ShipmentEvent.Status.OUT_FOR_DELIVERY, location="Chennai last-mile hub").exists())
        event_count = ShipmentEvent.objects.filter(order=order).count()

        duplicate_resp = public_client.post("/api/shipping/webhook", payload, format="json", HTTP_X_SHIPROCKET_WEBHOOK_SECRET="testsecret")
        self.assertEqual(duplicate_resp.status_code, 200)
        self.assertEqual(ShipmentEvent.objects.filter(order=order).count(), event_count)
        self.assertTrue(AdminAuditLog.objects.filter(action="shipping.webhook", entity_id=str(order.shipment.id)).exists())
        audit_resp = self.client.get("/api/admin/audit-logs")
        self.assertEqual(audit_resp.status_code, 200)
        self.assertTrue(any(log["action"] == "shipping.webhook" for log in audit_resp.json()))

    def test_customer_can_download_invoice(self):
        self.client.post("/api/cart", {"variant_id": self.variant.id, "quantity": 1}, format="json")
        order_resp = self.client.post("/api/orders", {"address_id": self.address.id, "payment_method": "cod"}, format="json")
        invoice_resp = self.client.get(f"/api/orders/{order_resp.json()['id']}/invoice")
        self.assertEqual(invoice_resp.status_code, 200)
        self.assertIn("CSM Silks Tax Invoice", invoice_resp.content.decode())

    def test_customer_cannot_request_return_before_delivery(self):
        self.client.post("/api/cart", {"variant_id": self.variant.id, "quantity": 1}, format="json")
        order_resp = self.client.post("/api/orders", {"address_id": self.address.id, "payment_method": "cod"}, format="json")
        order_id = order_resp.json()["id"]

        return_resp = self.client.post(
            "/api/returns",
            {"order_id": order_id, "reason": "Changed mind", "details": "Trying to return before delivery."},
            format="json",
        )

        self.assertEqual(return_resp.status_code, 400)
        self.assertIn("delivered", return_resp.json()["detail"].lower())
        self.assertFalse(ReturnRequest.objects.filter(order_id=order_id).exists())
        self.assertEqual(Order.objects.get(id=order_id).status, Order.Status.CONFIRMED)

    def test_customer_cannot_create_duplicate_active_return(self):
        self.client.post("/api/cart", {"variant_id": self.variant.id, "quantity": 1}, format="json")
        order_resp = self.client.post("/api/orders", {"address_id": self.address.id, "payment_method": "cod"}, format="json")
        order_id = order_resp.json()["id"]
        order = Order.objects.get(id=order_id)
        order.status = Order.Status.DELIVERED
        order.delivered_at = timezone.now()
        order.save(update_fields=["status", "delivered_at", "updated_at"])

        first_resp = self.client.post(
            "/api/returns",
            {"order_id": order_id, "reason": "Size issue", "details": "First return request."},
            format="json",
        )
        second_resp = self.client.post(
            "/api/returns",
            {"order_id": order_id, "reason": "Duplicate", "details": "Second return request."},
            format="json",
        )

        self.assertEqual(first_resp.status_code, 201)
        self.assertEqual(second_resp.status_code, 400)
        self.assertEqual(ReturnRequest.objects.filter(order_id=order_id).count(), 1)
        self.assertEqual(Order.objects.get(id=order_id).status, Order.Status.RETURN_INITIATED)

    def test_admin_refund_return_restocks_payment_and_loyalty_once(self):
        self.user.loyalty_points = 100
        self.user.save(update_fields=["loyalty_points"])
        self.client.post("/api/cart", {"variant_id": self.variant.id, "quantity": 1}, format="json")
        order_resp = self.client.post(
            "/api/orders",
            {"address_id": self.address.id, "payment_method": "cod", "loyalty_points_to_use": 20},
            format="json",
        )
        order_id = order_resp.json()["id"]
        order = Order.objects.get(id=order_id)
        order.status = Order.Status.DELIVERED
        order.delivered_at = timezone.now()
        order.save(update_fields=["status", "delivered_at", "updated_at"])
        self.variant.refresh_from_db()
        self.assertEqual(self.variant.stock_qty, 1)

        return_resp = self.client.post(
            "/api/returns",
            {"order_id": order_id, "reason": "Fabric defect", "details": "Customer reported a weaving defect."},
            format="json",
        )
        self.assertEqual(return_resp.status_code, 201)
        return_id = return_resp.json()["id"]
        admin = User.objects.create_user(username="return-admin", email="return@example.com", password="admin123", is_staff=True)
        self.client.force_authenticate(admin)

        refund_resp = self.client.patch(f"/api/admin/returns/{return_id}", {"status": "refunded"}, format="json")
        second_refund_resp = self.client.patch(f"/api/admin/returns/{return_id}", {"status": "refunded"}, format="json")

        self.assertEqual(refund_resp.status_code, 200)
        self.assertEqual(second_refund_resp.status_code, 200)
        order.refresh_from_db()
        self.variant.refresh_from_db()
        self.product.refresh_from_db()
        self.user.refresh_from_db()
        payment = Payment.objects.get(order=order)
        self.assertEqual(order.status, Order.Status.REFUNDED)
        self.assertEqual(ReturnRequest.objects.get(id=return_id).status, ReturnRequest.Status.REFUNDED)
        self.assertEqual(self.variant.stock_qty, 2)
        self.assertEqual(self.product.total_sold, 0)
        self.assertEqual(payment.status, Payment.Status.REFUNDED)
        self.assertEqual(payment.refunded_amount, order.total_amount)
        self.assertEqual(self.user.loyalty_points, 100)
        self.assertEqual(StockLedger.objects.filter(variant=self.variant, reason=StockLedger.Reason.RETURN, reference=f"{order.order_number}:return").count(), 1)
        self.assertTrue(ShipmentEvent.objects.filter(order=order, status=ShipmentEvent.Status.REFUNDED).exists())
        self.assertTrue(Notification.objects.filter(user=self.user, notification_type="order", title__icontains="refunded").exists())


class ProductApiTests(TestCase):
    def test_product_listing_shape_matches_frontend(self):
        category = Category.objects.create(name="Silk Dhoti", slug="mens-dhoti", gender="men")
        product = Product.objects.create(name="Pure Silk Dhoti", slug="pure-silk-dhoti", category=category, gender="men", base_price=Decimal("4999"), base_mrp=Decimal("6499"))
        ProductVariant.objects.create(product=product, sku="CSM-MD-001", color_name="Cream", color_hex="#F5E4B8", price=Decimal("4999"), mrp=Decimal("6499"), stock_qty=4)

        resp = APIClient().get("/api/products?gender=men")
        self.assertEqual(resp.status_code, 200)
        item = resp.json()["items"][0]
        self.assertEqual(item["slug"], "pure-silk-dhoti")
        self.assertIn("badge-text", item)
        self.assertIn("variant_id", item)

    def test_admin_can_upload_product_image_for_quick_create(self):
        admin = User.objects.create_user(username="admin-upload", email="upload@example.com", password="admin123", is_staff=True)
        client = APIClient()
        client.force_authenticate(admin)
        image = SimpleUploadedFile("saree.jpg", b"\xff\xd8\xff\xe0test-image", content_type="image/jpeg")
        resp = client.post("/api/admin/product-images", {"image": image}, format="multipart")
        self.assertEqual(resp.status_code, 201)
        self.assertIn("/media/product-images/", resp.json()["image_url"])


class CouponFallbackRemovalTests(TestCase):
    """orders.pricing used to grant CSM10/COMEBACK10 a flat 10% with no Coupon row,
    so deactivating or expiring those codes in admin had no effect."""

    def test_deactivated_coupon_gives_no_discount(self):
        Coupon.objects.create(code="CSM10", is_active=False, discount_type=Coupon.DiscountType.PERCENT, value=Decimal("10"))
        self.assertEqual(calculate_coupon_discount(Decimal("10000.00"), "CSM10"), Decimal("0.00"))

    def test_expired_coupon_gives_no_discount(self):
        Coupon.objects.create(
            code="CSM10", is_active=True, discount_type=Coupon.DiscountType.PERCENT, value=Decimal("10"),
            expires_at=timezone.now() - timedelta(days=30),
        )
        self.assertEqual(calculate_coupon_discount(Decimal("10000.00"), "CSM10"), Decimal("0.00"))

    def test_unknown_code_gives_no_discount(self):
        self.assertEqual(calculate_coupon_discount(Decimal("50.00"), "COMEBACK10"), Decimal("0.00"))
        self.assertEqual(calculate_coupon_discount(Decimal("50.00"), "  csm10  "), Decimal("0.00"))

    def test_active_coupon_row_still_applies_and_honours_min_order_value(self):
        Coupon.objects.create(
            code="CSM10", is_active=True, discount_type=Coupon.DiscountType.PERCENT,
            value=Decimal("10"), min_order_value=Decimal("1000.00"),
        )
        self.assertEqual(calculate_coupon_discount(Decimal("10000.00"), "CSM10"), Decimal("1000.00"))
        self.assertEqual(calculate_coupon_discount(Decimal("500.00"), "CSM10"), Decimal("0.00"))


class InvoiceTotalsTests(TestCase):
    """Order.subtotal already includes finishing_amount, so printing both lines
    overstated the invoice by the finishing fee."""

    def test_printed_lines_reconcile_with_total(self):
        user = User.objects.create_user(username="inv-1", email="inv1@example.com", password="pw123456")
        order = Order.objects.create(
            order_number="CSM-INV-1", user=user,
            subtotal=Decimal("10500.00"),      # 10000 goods + 500 finishing
            finishing_amount=Decimal("500.00"),
            discount_amount=Decimal("0.00"),
            cgst_amount=Decimal("262.50"), sgst_amount=Decimal("262.50"),
            shipping_amount=Decimal("0.00"),
            total_amount=Decimal("11025.00"),
            status=Order.Status.CONFIRMED, payment_method=Order.PaymentMethod.COD,
        )
        html = render_invoice_html(order)
        self.assertIn("<strong>Subtotal:</strong> Rs 10000.00", html)
        self.assertIn("<strong>House finishing:</strong> Rs 500.00", html)

        printed = (
            (order.subtotal - order.finishing_amount) + order.finishing_amount
            - order.discount_amount + order.cgst_amount + order.sgst_amount + order.shipping_amount
        )
        self.assertEqual(printed, order.total_amount)


class RestockUsesDatabaseArithmeticTests(TestCase):
    """_restock_order_items did a read-modify-write on an unlocked variant, so a
    concurrent purchase's decrement was lost and stock inflated."""

    def test_restock_does_not_clobber_a_concurrent_decrement(self):
        category = Category.objects.create(name="Silk", slug="silk-restock-race")
        product = Product.objects.create(name="Race Saree", slug="race-saree", category=category, is_active=True, total_sold=5)
        variant = ProductVariant.objects.create(
            product=product, sku="RACE-1", price=Decimal("1000.00"), mrp=Decimal("1200.00"), stock_qty=10
        )

        # These stale in-memory copies stand in for the rows _restock_order_items reads
        # before it writes. The variant is never locked, so a concurrent purchase can land
        # in between.
        stale_variant = ProductVariant.objects.get(pk=variant.pk)
        stale_product = Product.objects.get(pk=product.pk)
        self.assertEqual(stale_variant.stock_qty, 10)

        ProductVariant.objects.filter(pk=variant.pk).update(stock_qty=F("stock_qty") - 3)
        Product.objects.filter(pk=product.pk).update(total_sold=F("total_sold") + 3)

        _restock_variant(stale_variant, stale_product, 2)

        variant.refresh_from_db()
        product.refresh_from_db()
        # 10 - 3 (concurrent sale) + 2 (restock) = 9. A read-modify-write off the stale
        # copy would have written 10 + 2 = 12 and lost the sale.
        self.assertEqual(variant.stock_qty, 9)
        # 5 + 3 (concurrent sale) - 2 (restock) = 6, not 5 - 2 = 3.
        self.assertEqual(product.total_sold, 6)

    def test_restock_floors_total_sold_at_zero(self):
        user = User.objects.create_user(username="restock-2", email="restock2@example.com", password="pw123456")
        category = Category.objects.create(name="Silk", slug="silk-restock-floor")
        product = Product.objects.create(name="Floor Saree", slug="floor-saree", category=category, is_active=True, total_sold=1)
        variant = ProductVariant.objects.create(
            product=product, sku="FLOOR-1", price=Decimal("1000.00"), mrp=Decimal("1200.00"), stock_qty=0
        )
        order = Order.objects.create(
            order_number="CSM-FLOOR-1", user=user, subtotal=Decimal("5000.00"), total_amount=Decimal("5000.00"),
            status=Order.Status.CONFIRMED, payment_method=Order.PaymentMethod.COD,
        )
        OrderItem.objects.create(
            order=order, product=product, variant=variant, product_name=product.name,
            product_sku=variant.sku, unit_price=Decimal("1000.00"), quantity=5, subtotal=Decimal("5000.00"),
        )

        _restock_order_items(order)

        product.refresh_from_db()
        self.assertEqual(product.total_sold, 0)
        variant.refresh_from_db()
        self.assertEqual(variant.stock_qty, 5)

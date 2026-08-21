from datetime import timedelta
from decimal import Decimal
from pathlib import Path

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from analytics.models import AdminAuditLog
from analytics.views import insight_window
from orders.models import Order, ReturnRequest
from payments.models import Payment

User = get_user_model()


def money(value) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"))


class AdminAnalyticsApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            username="analytics-admin",
            email="analytics-admin@example.com",
            password="admin123",
            is_staff=True,
        )
        self.customer = User.objects.create_user(
            username="+919811111111",
            phone="+919811111111",
            password="customer123",
            is_verified=True,
        )
        self.client.force_authenticate(self.admin)

    def create_order_with_payment(
        self,
        *,
        number: str,
        amount: Decimal,
        order_status: str,
        payment_status: str,
        refunded_amount: Decimal = Decimal("0.00"),
    ) -> Order:
        order = Order.objects.create(
            order_number=number,
            user=self.customer,
            subtotal=amount,
            cgst_amount=Decimal("0.00"),
            sgst_amount=Decimal("0.00"),
            total_amount=amount,
            status=order_status,
            payment_method=Order.PaymentMethod.RAZORPAY,
            delivered_at=timezone.now() if order_status in {Order.Status.DELIVERED, Order.Status.REFUNDED} else None,
        )
        Payment.objects.create(
            order=order,
            amount=amount,
            method=Payment.Method.CARD,
            status=payment_status,
            razorpay_order_id=f"order_{number}",
            razorpay_payment_id=f"pay_{number}",
            is_hmac_verified=True,
            refunded_amount=refunded_amount,
            paid_at=timezone.now() if payment_status != Payment.Status.PENDING else None,
        )
        return order

    def test_dashboard_uses_net_paid_revenue_and_refund_totals(self):
        self.create_order_with_payment(
            number="CSM-AN-PAID-1",
            amount=Decimal("100.00"),
            order_status=Order.Status.DELIVERED,
            payment_status=Payment.Status.PARTIALLY_REFUNDED,
            refunded_amount=Decimal("40.00"),
        )
        self.create_order_with_payment(
            number="CSM-AN-REF-1",
            amount=Decimal("60.00"),
            order_status=Order.Status.REFUNDED,
            payment_status=Payment.Status.REFUNDED,
            refunded_amount=Decimal("60.00"),
        )
        self.create_order_with_payment(
            number="CSM-AN-PENDING-1",
            amount=Decimal("500.00"),
            order_status=Order.Status.PAYMENT_PENDING,
            payment_status=Payment.Status.PENDING,
        )

        response = self.client.get("/api/admin/dashboard")

        self.assertEqual(response.status_code, 200)
        kpis = response.json()["kpis"]
        self.assertEqual(money(kpis["gross_revenue_today"]), Decimal("160.00"))
        self.assertEqual(money(kpis["refunds_today"]), Decimal("100.00"))
        self.assertEqual(money(kpis["net_revenue_today"]), Decimal("60.00"))
        self.assertEqual(money(kpis["revenue_today"]), Decimal("60.00"))
        self.assertEqual(kpis["refunded_orders_today"], 1)

    def test_reports_include_net_gross_refunds_and_return_rate(self):
        paid = self.create_order_with_payment(
            number="CSM-AN-REPORT-PAID",
            amount=Decimal("200.00"),
            order_status=Order.Status.DELIVERED,
            payment_status=Payment.Status.CAPTURED,
        )
        refunded = self.create_order_with_payment(
            number="CSM-AN-REPORT-REF",
            amount=Decimal("150.00"),
            order_status=Order.Status.REFUNDED,
            payment_status=Payment.Status.REFUNDED,
            refunded_amount=Decimal("150.00"),
        )
        ReturnRequest.objects.create(
            order=refunded,
            user=self.customer,
            reason="Fabric defect",
            status=ReturnRequest.Status.REFUNDED,
        )
        self.create_order_with_payment(
            number="CSM-AN-REPORT-PENDING",
            amount=Decimal("700.00"),
            order_status=Order.Status.PAYMENT_PENDING,
            payment_status=Payment.Status.PENDING,
        )

        response = self.client.get("/api/admin/reports")

        self.assertEqual(response.status_code, 200)
        report = response.json()
        self.assertEqual(money(report["gross_revenue"]), Decimal("350.00"))
        self.assertEqual(money(report["refunds"]), Decimal("150.00"))
        self.assertEqual(money(report["net_revenue"]), Decimal("200.00"))
        self.assertEqual(money(report["total_revenue"]), Decimal("200.00"))
        self.assertEqual(report["paid_orders"], 2)
        self.assertEqual(report["return_orders"], 1)
        self.assertEqual(money(report["return_rate"]), Decimal("50.00"))

    def test_audit_logs_can_be_filtered_for_traceability(self):
        AdminAuditLog.objects.create(
            user=self.admin,
            action="payment.refund",
            entity_type="Payment",
            entity_id="101",
            summary="Refunded CSM-AN-001.",
        )
        AdminAuditLog.objects.create(
            user=self.admin,
            action="order.workflow.pack",
            entity_type="Order",
            entity_id="202",
            summary="Packed CSM-AN-002.",
        )

        response = self.client.get("/api/admin/audit-logs?action=payment.refund&q=CSM-AN-001")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body), 1)
        self.assertEqual(body[0]["action"], "payment.refund")
        self.assertEqual(body[0]["entity_id"], "101")


class AdminRealtimeCoverageTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        root = Path(__file__).resolve().parents[2]
        cls.admin_source = (root / "frontend" / "src" / "pages" / "Admin.tsx").read_text(encoding="utf-8")

    def function_body(self, name: str) -> str:
        marker = f"function {name}("
        start = self.admin_source.index(marker)
        next_function = self.admin_source.find("\nfunction ", start + len(marker))
        if next_function == -1:
            return self.admin_source[start:]
        return self.admin_source[start:next_function]

    def assert_subscribes_to_order_events(self, component_name: str):
        self.assertIn("connectOrderRealtime('/ws/orders/'", self.function_body(component_name))

    def assert_subscribes_to_catalog_events(self, component_name: str):
        self.assertIn("useCatalogLiveRefresh", self.function_body(component_name))

    def test_dashboard_refreshes_from_order_and_catalog_events(self):
        self.assert_subscribes_to_order_events("AdminDashboard")
        self.assert_subscribes_to_catalog_events("AdminDashboard")

    def test_reports_and_customers_refresh_from_order_events(self):
        self.assert_subscribes_to_order_events("AdminReports")
        self.assert_subscribes_to_order_events("AdminCustomers")

    def test_audit_logs_refresh_from_order_and_catalog_events(self):
        self.assert_subscribes_to_order_events("AdminAuditLogs")
        self.assert_subscribes_to_catalog_events("AdminAuditLogs")

    def test_stock_alerts_refresh_from_catalog_inventory_events(self):
        self.assert_subscribes_to_catalog_events("AdminUnsold")


class RealtimeClientAuthResilienceTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        root = Path(__file__).resolve().parents[2]
        cls.api_source = (root / "frontend" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
        cls.realtime_source = (root / "frontend" / "src" / "lib" / "realtime.ts").read_text(encoding="utf-8")

    def test_api_exposes_access_token_refresh_for_realtime_client(self):
        self.assertIn("refreshAccessToken", self.api_source)
        self.assertIn("tokens: {", self.api_source)
        self.assertIn("getAccessToken", self.api_source)
        self.assertIn("refreshAccessToken", self.api_source)
        self.assertIn("ensureFreshAccessToken", self.api_source)

    def test_realtime_client_refreshes_token_before_or_after_unauthorized_close(self):
        self.assertIn("api.tokens.refreshAccessToken", self.realtime_source)
        self.assertIn("event.code === 4401", self.realtime_source)
        self.assertIn("await api.tokens.refreshAccessToken()", self.realtime_source)


class RealtimeClientHeartbeatTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        root = Path(__file__).resolve().parents[2]
        cls.realtime_source = (root / "frontend" / "src" / "lib" / "realtime.ts").read_text(encoding="utf-8")

    def test_realtime_client_sends_ping_and_consumes_pong_frames(self):
        self.assertIn("HEARTBEAT_INTERVAL_MS", self.realtime_source)
        self.assertIn("HEARTBEAT_TIMEOUT_MS", self.realtime_source)
        self.assertIn("JSON.stringify({ type: 'ping' })", self.realtime_source)
        self.assertIn("message.type === 'pong'", self.realtime_source)

    def test_realtime_client_closes_stale_socket_to_force_reconnect(self):
        self.assertIn("startHeartbeat()", self.realtime_source)
        self.assertIn("clearHeartbeat()", self.realtime_source)
        self.assertIn("heartbeat-timeout", self.realtime_source)


class FrontendAuthSessionResilienceTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        root = Path(__file__).resolve().parents[2]
        cls.api_source = (root / "frontend" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
        cls.app_source = (root / "frontend" / "src" / "store" / "AppContext.tsx").read_text(encoding="utf-8")
        cls.admin_source = (root / "frontend" / "src" / "pages" / "Admin.tsx").read_text(encoding="utf-8")

    def test_api_client_can_discard_expired_jwts_before_network_requests(self):
        self.assertIn("function isJwtExpired", self.api_source)
        self.assertIn("ensureFreshAccessToken", self.api_source)
        self.assertIn("hasStoredSession", self.api_source)
        self.assertIn("getRefreshToken", self.api_source)

    def test_session_boot_refreshes_or_clears_before_auth_me(self):
        self.assertIn("await api.tokens.ensureFreshAccessToken()", self.app_source)
        self.assertIn("await api.tokens.ensureFreshAccessToken()", self.admin_source)


class FrontendNoRuntimeMockSurfacesTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        root = Path(__file__).resolve().parents[2]
        cls.tracking_source = (root / "frontend" / "src" / "pages" / "Tracking.tsx").read_text(encoding="utf-8")

    def test_tracking_lookup_does_not_show_sample_order_number(self):
        self.assertNotIn("CSM-20260530-26701", self.tracking_source)


class FrontendOrderPaginationCoverageTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        root = Path(__file__).resolve().parents[2]
        cls.api_source = (root / "frontend" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
        cls.orders_source = (root / "frontend" / "src" / "pages" / "Orders.tsx").read_text(encoding="utf-8")
        cls.admin_source = (root / "frontend" / "src" / "pages" / "Admin.tsx").read_text(encoding="utf-8")

    def test_customer_order_api_and_screen_request_bounded_pages(self):
        self.assertIn("list: (params?:", self.api_source)
        self.assertIn("`/orders${qs}`", self.api_source)
        self.assertIn("ORDER_PAGE_SIZE", self.orders_source)
        self.assertIn("loadOrdersPage(pageInfo.page + 1, true)", self.orders_source)

    def test_admin_order_api_and_screen_request_bounded_pages(self):
        self.assertIn("orders: (params?:", self.api_source)
        self.assertIn("`/admin/orders${qs}`", self.api_source)
        self.assertIn("ADMIN_ORDER_PAGE_SIZE", self.admin_source)
        self.assertIn("loadOrdersPage(orderPageInfo.page + 1, true)", self.admin_source)


class FrontendNotificationPaginationCoverageTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        root = Path(__file__).resolve().parents[2]
        cls.api_source = (root / "frontend" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
        cls.app_source = (root / "frontend" / "src" / "store" / "AppContext.tsx").read_text(encoding="utf-8")
        cls.notifications_source = (root / "frontend" / "src" / "pages" / "Notifications.tsx").read_text(encoding="utf-8")

    def test_notification_api_exposes_bounded_pages_and_unread_count(self):
        self.assertIn("type NotificationListResponse", self.api_source)
        self.assertIn("list: (params?:", self.api_source)
        self.assertIn("`/notifications${qs}`", self.api_source)
        self.assertIn("unread_count", self.api_source)

    def test_bell_count_uses_backend_unread_count_without_fetching_full_collection(self):
        self.assertIn("api.notifications.count()", self.app_source)
        self.assertNotIn("notifications.filter(item => item.is_read === false).length", self.app_source)

    def test_notifications_page_uses_paged_load_more_flow(self):
        self.assertIn("NOTIFICATION_PAGE_SIZE", self.notifications_source)
        self.assertIn("loadNotificationPage(pageInfo.page + 1, true)", self.notifications_source)


class AdminInsightsApiTests(TestCase):
    """The dashboard charts read straight off /api/admin/insights, so the shapes asserted
    here (gap-filled series, clamped window, per-bucket breakdowns) are load-bearing."""

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            username="insights-admin",
            email="insights-admin@example.com",
            password="admin123",
            is_staff=True,
        )
        self.customer = User.objects.create_user(
            username="+919822222222",
            phone="+919822222222",
            password="customer123",
            is_verified=True,
        )
        self.client.force_authenticate(self.admin)

    def make_paid_order(self, number, amount, *, refunded="0.00", method=Payment.Method.UPI, days_ago=0):
        order = Order.objects.create(
            order_number=number,
            user=self.customer,
            subtotal=Decimal(amount),
            cgst_amount=Decimal("0.00"),
            sgst_amount=Decimal("0.00"),
            total_amount=Decimal(amount),
            status=Order.Status.DELIVERED,
            payment_method=Order.PaymentMethod.RAZORPAY,
        )
        if days_ago:
            # created_at is auto_now_add, so backdating needs an update() that skips the field default.
            moment = timezone.now() - timedelta(days=days_ago)
            Order.objects.filter(pk=order.pk).update(created_at=moment)
            order.refresh_from_db()
        Payment.objects.create(
            order=order,
            amount=Decimal(amount),
            method=method,
            status=Payment.Status.PARTIALLY_REFUNDED if Decimal(refunded) else Payment.Status.CAPTURED,
            razorpay_order_id=f"order_{number}",
            razorpay_payment_id=f"pay_{number}",
            is_hmac_verified=True,
            refunded_amount=Decimal(refunded),
            paid_at=timezone.now(),
        )
        return order

    def test_series_is_gap_filled_across_the_whole_window(self):
        self.make_paid_order("CSM-IN-1", "1000.00")

        response = self.client.get("/api/admin/insights?days=7")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["days"], 7)
        # One row per calendar day, including the six days with no orders at all.
        self.assertEqual(len(body["revenue_series"]), 7)
        self.assertEqual(body["revenue_series"][-1]["date"], timezone.localdate().isoformat())
        self.assertEqual([money(row["net"]) for row in body["revenue_series"][:-1]], [Decimal("0.00")] * 6)
        self.assertEqual(money(body["revenue_series"][-1]["net"]), Decimal("1000.00"))

    def test_totals_net_out_refunds_and_average_over_paid_orders(self):
        self.make_paid_order("CSM-IN-A", "1000.00", refunded="200.00")
        self.make_paid_order("CSM-IN-B", "600.00")

        body = self.client.get("/api/admin/insights?days=30").json()

        self.assertEqual(money(body["totals"]["gross"]), Decimal("1600.00"))
        self.assertEqual(money(body["totals"]["refunds"]), Decimal("200.00"))
        self.assertEqual(money(body["totals"]["net"]), Decimal("1400.00"))
        self.assertEqual(body["totals"]["paid_orders"], 2)
        self.assertEqual(money(body["totals"]["avg_order_value"]), Decimal("700.00"))

    def test_breakdowns_bucket_by_status_and_payment_method(self):
        self.make_paid_order("CSM-IN-UPI", "500.00", method=Payment.Method.UPI)
        self.make_paid_order("CSM-IN-CARD", "300.00", method=Payment.Method.CARD)

        body = self.client.get("/api/admin/insights?days=30").json()

        self.assertEqual([row["status"] for row in body["orders_by_status"]], ["delivered"])
        self.assertEqual(body["orders_by_status"][0]["count"], 2)
        methods = {row["method"]: money(row["amount"]) for row in body["payment_mix"]}
        self.assertEqual(methods, {"upi": Decimal("500.00"), "card": Decimal("300.00")})

    def test_window_outside_the_offered_set_is_clamped_not_honoured(self):
        # Guards the query param: an arbitrary `days` must not become an arbitrary scan.
        self.assertEqual(insight_window({"days": "9999"}), 365)
        self.assertEqual(insight_window({"days": "1"}), 7)
        self.assertEqual(insight_window({"days": "not-a-number"}), 30)
        self.assertEqual(insight_window({}), 30)
        self.assertEqual(self.client.get("/api/admin/insights?days=9999").json()["days"], 365)

    def test_orders_outside_the_window_are_excluded(self):
        self.make_paid_order("CSM-IN-OLD", "5000.00", days_ago=40)
        self.make_paid_order("CSM-IN-NEW", "100.00")

        body = self.client.get("/api/admin/insights?days=7").json()

        self.assertEqual(money(body["totals"]["net"]), Decimal("100.00"))

    def test_requires_staff(self):
        self.client.force_authenticate(self.customer)
        self.assertEqual(self.client.get("/api/admin/insights").status_code, 403)

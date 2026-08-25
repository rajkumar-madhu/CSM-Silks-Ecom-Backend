from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db.models import Count, DecimalField, Q, Sum, Value
from django.db.models.functions import Coalesce, TruncDate
from django.utils import timezone
from accounts.permissions import IsStaffAdmin
from rest_framework.response import Response
from rest_framework.views import APIView

from ai.models import TryOnSession
from catalog.models import Product
from inventory.models import UnsoldAlert
from orders.models import Order, OrderItem, ReturnRequest
from payments.models import Payment
from reviews.models import ProductReview

from .models import AdminAuditLog
from .serializers import AdminAuditLogSerializer

User = get_user_model()

PAID_PAYMENT_STATUSES = {
    Payment.Status.CAPTURED,
    Payment.Status.PARTIALLY_REFUNDED,
    Payment.Status.REFUNDED,
}


def zero_money() -> Decimal:
    return Decimal("0.00")


def payment_revenue(payments):
    gross = payments.aggregate(total=Sum("amount"))["total"] or zero_money()
    refunds = payments.aggregate(total=Sum("refunded_amount"))["total"] or zero_money()
    net = gross - refunds
    return {
        "gross": gross,
        "refunds": refunds,
        "net": net,
        "paid_orders": payments.count(),
        "refunded_orders": payments.filter(status=Payment.Status.REFUNDED).count(),
        "partially_refunded_orders": payments.filter(status=Payment.Status.PARTIALLY_REFUNDED).count(),
    }


def paid_payments():
    return Payment.objects.select_related("order", "order__user").filter(status__in=PAID_PAYMENT_STATUSES)


# Windows the dashboard charts offer. Bounded on purpose: `days` comes straight off a query
# string, and an unbounded value would let an anonymous-looking request ask for a full-table
# per-day scan.
INSIGHT_WINDOWS = (7, 30, 90, 180, 365)
DEFAULT_INSIGHT_WINDOW = 30


def insight_window(params) -> int:
    """Clamp the ?days= query param to the nearest offered window (default 30)."""
    raw = params.get("days")
    try:
        requested = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_INSIGHT_WINDOW
    return min(INSIGHT_WINDOWS, key=lambda window: (abs(window - requested), window))


def _money_sum(field):
    return Coalesce(Sum(field), Value(Decimal("0.00")), output_field=DecimalField(max_digits=14, decimal_places=2))


class AdminInsightsView(APIView):
    """Time series and top-N breakdowns behind the admin dashboard charts.

    Every series is emitted **gap-filled** over the whole window — a day with no orders is a
    zero row, not a missing one. Charts that plot a sparse series draw a misleading slope
    between the surviving points, and the client should not have to reconstruct the calendar.
    """

    permission_classes = [IsStaffAdmin]

    def get(self, request):
        days = insight_window(request.query_params)
        today = timezone.localdate()
        start = today - timedelta(days=days - 1)

        payments = paid_payments().filter(order__created_at__date__gte=start)
        revenue_rows = {
            row["day"]: row
            for row in payments.annotate(day=TruncDate("order__created_at"))
            .values("day")
            .annotate(
                gross=_money_sum("amount"),
                refunds=_money_sum("refunded_amount"),
                paid_orders=Count("id", distinct=True),
            )
        }
        order_rows = {
            row["day"]: row["orders"]
            for row in Order.objects.filter(created_at__date__gte=start)
            .annotate(day=TruncDate("created_at"))
            .values("day")
            .annotate(orders=Count("id", distinct=True))
        }
        customer_rows = {
            row["day"]: row["customers"]
            for row in User.objects.filter(role=User.Role.CUSTOMER, date_joined__date__gte=start)
            .annotate(day=TruncDate("date_joined"))
            .values("day")
            .annotate(customers=Count("id", distinct=True))
        }

        revenue_series = []
        for offset in range(days):
            day = start + timedelta(days=offset)
            row = revenue_rows.get(day, {})
            gross = row.get("gross") or zero_money()
            refunds = row.get("refunds") or zero_money()
            revenue_series.append(
                {
                    "date": day.isoformat(),
                    "gross": gross,
                    "refunds": refunds,
                    "net": gross - refunds,
                    "orders": order_rows.get(day, 0),
                    "paid_orders": row.get("paid_orders", 0),
                    "customers": customer_rows.get(day, 0),
                }
            )

        orders_in_window = Order.objects.filter(created_at__date__gte=start)
        orders_by_status = [
            {"status": row["status"], "label": Order.Status(row["status"]).label, "count": row["count"]}
            for row in orders_in_window.values("status").annotate(count=Count("id")).order_by("-count")
        ]

        items = OrderItem.objects.filter(order__created_at__date__gte=start)
        top_products = [
            {
                "name": row["product_name"],
                "units": row["units"],
                "revenue": row["revenue"],
            }
            for row in items.values("product_name")
            .annotate(units=Coalesce(Sum("quantity"), 0), revenue=_money_sum("subtotal"))
            .order_by("-revenue", "-units")[:8]
        ]
        category_mix = [
            {
                "category": row["product__category__name"] or "Uncategorised",
                "units": row["units"],
                "revenue": row["revenue"],
            }
            for row in items.values("product__category__name")
            .annotate(units=Coalesce(Sum("quantity"), 0), revenue=_money_sum("subtotal"))
            .order_by("-revenue")[:8]
        ]
        payment_mix = [
            {
                # `method` is blank until the gateway reports one back, which is not the same
                # thing as an unknown method — surface it as its own bucket rather than
                # silently folding those payments into UPI or dropping them from the chart.
                "method": row["method"] or "unrecorded",
                "label": Payment.Method(row["method"]).label if row["method"] else "Not recorded",
                "count": row["count"],
                "amount": row["amount"],
            }
            for row in payments.values("method").annotate(count=Count("id"), amount=_money_sum("amount")).order_by("-amount")
        ]

        totals_gross = sum((row["gross"] for row in revenue_series), zero_money())
        totals_refunds = sum((row["refunds"] for row in revenue_series), zero_money())
        total_orders = sum(row["orders"] for row in revenue_series)
        net = totals_gross - totals_refunds
        return Response(
            {
                "days": days,
                "start": start.isoformat(),
                "end": today.isoformat(),
                "windows": list(INSIGHT_WINDOWS),
                "totals": {
                    "gross": totals_gross,
                    "refunds": totals_refunds,
                    "net": net,
                    "orders": total_orders,
                    "paid_orders": sum(row["paid_orders"] for row in revenue_series),
                    "customers": sum(row["customers"] for row in revenue_series),
                    # Average order value is over *paid* orders: dividing net revenue by every
                    # order created would count abandoned/payment_pending rows in the divisor.
                    "avg_order_value": (
                        (net / Decimal(sum(row["paid_orders"] for row in revenue_series))).quantize(Decimal("0.01"))
                        if sum(row["paid_orders"] for row in revenue_series)
                        else zero_money()
                    ),
                },
                "revenue_series": revenue_series,
                "orders_by_status": orders_by_status,
                "top_products": top_products,
                "category_mix": category_mix,
                "payment_mix": payment_mix,
            }
        )


# Statuses that still need a human on the floor. These back the console sidebar badges, so
# keep them aligned with the workflow actions the Orders / Returns / Reviews screens offer:
# a badge counting rows nobody can act on is worse than no badge at all.
ACTIONABLE_ORDER_STATUSES = (
    Order.Status.PENDING,
    Order.Status.PAYMENT_PENDING,
    Order.Status.CONFIRMED,
    Order.Status.QUALITY_CHECK,
    Order.Status.PACKED,
)
OPEN_RETURN_STATUSES = (
    ReturnRequest.Status.REQUESTED,
    ReturnRequest.Status.APPROVED,
    ReturnRequest.Status.PICKED_UP,
)


class AdminDashboardView(APIView):
    permission_classes = [IsStaffAdmin]

    def get(self, request):
        today = timezone.localdate()
        month_start = today.replace(day=1)
        payments = paid_payments()
        today_revenue = payment_revenue(payments.filter(order__created_at__date=today))
        month_revenue = payment_revenue(payments.filter(order__created_at__date__gte=month_start))
        orders_today = Order.objects.filter(created_at__date=today).count()
        returns_today = ReturnRequest.objects.filter(created_at__date=today).count()
        low_stock = Product.objects.filter(variants__stock_qty__lte=5, is_active=True).distinct().count()
        unsold = UnsoldAlert.objects.filter(resolved=False)
        recent_orders = Order.objects.order_by("-created_at")[:10]
        top = (
            OrderItem.objects.values("product_name")
            .annotate(units=Sum("quantity"))
            .order_by("-units")
            .first()
        )
        return Response(
            {
                "kpis": {
                    "revenue_today": today_revenue["net"],
                    "revenue_month": month_revenue["net"],
                    "gross_revenue_today": today_revenue["gross"],
                    "gross_revenue_month": month_revenue["gross"],
                    "refunds_today": today_revenue["refunds"],
                    "refunds_month": month_revenue["refunds"],
                    "net_revenue_today": today_revenue["net"],
                    "net_revenue_month": month_revenue["net"],
                    "orders_today": orders_today,
                    "paid_orders_today": today_revenue["paid_orders"],
                    "refunded_orders_today": today_revenue["refunded_orders"],
                    "partially_refunded_orders_today": today_revenue["partially_refunded_orders"],
                    "returns_today": returns_today,
                    "total_customers": User.objects.filter(role=User.Role.CUSTOMER).count(),
                    "tryon_sessions_today": TryOnSession.objects.filter(created_at__date=today).count(),
                    "low_stock_products": low_stock,
                    "unsold_alerts": unsold.count(),
                    "open_orders": Order.objects.filter(status__in=ACTIONABLE_ORDER_STATUSES).count(),
                    "open_returns": ReturnRequest.objects.filter(status__in=OPEN_RETURN_STATUSES).count(),
                    "unpublished_reviews": ProductReview.objects.filter(is_published=False).count(),
                    "capital_blocked": unsold.aggregate(total=Sum("capital_blocked"))["total"] or 0,
                    "top_product": top or {},
                },
                "recent_orders": [
                    {
                        "id": order.id,
                        "order_number": order.order_number,
                        "customer": order.user.display_name,
                        "status": order.status,
                        "total": order.total_amount,
                        "created_at": order.created_at,
                    }
                    for order in recent_orders
                ],
            }
        )


class AdminCustomersView(APIView):
    permission_classes = [IsStaffAdmin]

    def get(self, request):
        users = User.objects.filter(role=User.Role.CUSTOMER).annotate(order_count=Count("orders"), total_spent=Sum("orders__total_amount")).order_by("-date_joined")[:100]
        return Response(
            [
                {
                    "id": user.id,
                    "name": user.display_name,
                    "email": user.email,
                    "phone": user.phone,
                    "orders": user.order_count,
                    "spent": user.total_spent or 0,
                    "tier": user.loyalty_tier,
                    "since": user.date_joined,
                }
                for user in users
            ]
        )


class AdminReportsView(APIView):
    permission_classes = [IsStaffAdmin]

    def get(self, request):
        payments = paid_payments()
        revenue = payment_revenue(payments)
        paid_order_ids = payments.values_list("order_id", flat=True)
        paid_orders = Order.objects.filter(id__in=paid_order_ids)
        taxable = paid_orders.aggregate(total=Sum("subtotal"))["total"] or zero_money()
        cgst = paid_orders.aggregate(total=Sum("cgst_amount"))["total"] or zero_money()
        sgst = paid_orders.aggregate(total=Sum("sgst_amount"))["total"] or zero_money()
        total_orders = Order.objects.count()
        return_orders = ReturnRequest.objects.filter(status=ReturnRequest.Status.REFUNDED).count()
        return_rate = zero_money()
        if revenue["paid_orders"]:
            return_rate = (Decimal(return_orders) / Decimal(revenue["paid_orders"]) * Decimal("100")).quantize(Decimal("0.01"))
        return Response(
            {
                "total_revenue": revenue["net"],
                "gross_revenue": revenue["gross"],
                "refunds": revenue["refunds"],
                "net_revenue": revenue["net"],
                "total_orders": total_orders,
                "paid_orders": revenue["paid_orders"],
                "refunded_orders": revenue["refunded_orders"],
                "partially_refunded_orders": revenue["partially_refunded_orders"],
                "return_orders": return_orders,
                "return_rate": return_rate,
                "taxable_sales": taxable,
                "cgst": cgst,
                "sgst": sgst,
                "gst_total": cgst + sgst,
            }
        )


class AdminAuditLogView(APIView):
    permission_classes = [IsStaffAdmin]

    def get(self, request):
        logs = AdminAuditLog.objects.select_related("user").order_by("-created_at")
        action = request.query_params.get("action", "").strip()
        entity_type = request.query_params.get("entity_type", "").strip()
        query = request.query_params.get("q", "").strip()
        if action:
            logs = logs.filter(action=action)
        if entity_type:
            logs = logs.filter(entity_type__iexact=entity_type)
        if query:
            logs = logs.filter(
                Q(action__icontains=query)
                | Q(entity_type__icontains=query)
                | Q(entity_id__icontains=query)
                | Q(summary__icontains=query)
            )
        logs = logs[:100]
        return Response(AdminAuditLogSerializer(logs, many=True).data)

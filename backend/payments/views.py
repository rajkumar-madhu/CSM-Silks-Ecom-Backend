from __future__ import annotations

import logging
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from accounts.permissions import IsStaffAdmin
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from analytics.audit import record_admin_audit
from orders.models import Order
from orders.services import capture_razorpay_payment, order_payment_is_captured
from shipping.models import ShipmentEvent
from shipping.services import record_tracking_event

from .models import Payment, RazorpayWebhookEvent
from .serializers import RazorpayOrderCreateSerializer, RazorpayVerifySerializer, RefundSerializer
from .services import PaymentGatewayError, PaymentReconciliationError, apply_refund_reconciliation, create_gateway_order, refund_gateway_payment, validate_refund_amount, verify_payment_signature, verify_webhook_signature

logger = logging.getLogger(__name__)


class RazorpayOrderView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = "payment"

    def post(self, request):
        serializer = RazorpayOrderCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # get_object_or_404, not .get(): an unknown or someone else's order id would otherwise
        # raise Order.DoesNotExist straight out of the view as a 500 (there is no DRF
        # EXCEPTION_HANDLER configured). Scoping to request.user keeps it a 404, not a leak.
        order = get_object_or_404(
            Order.objects.select_related("payment"),
            id=serializer.validated_data["order_id"],
            user=request.user,
        )
        if order.payment_method != Order.PaymentMethod.RAZORPAY:
            return Response({"detail": "This order does not use Razorpay checkout"}, status=status.HTTP_400_BAD_REQUEST)
        if order.status not in {Order.Status.PAYMENT_PENDING, Order.Status.PENDING}:
            return Response({"detail": "This order is not awaiting payment"}, status=status.HTTP_400_BAD_REQUEST)
        if order_payment_is_captured(order):
            return Response({"detail": "Payment already captured for this order"}, status=status.HTTP_400_BAD_REQUEST)
        amount_paise = int(order.total_amount * 100)
        try:
            gateway_order = create_gateway_order(amount_paise, order.order_number, {"order_id": str(order.id), "user_id": str(request.user.id)})
        except PaymentGatewayError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        payment, _ = Payment.objects.get_or_create(order=order, defaults={"amount": order.total_amount})
        payment.razorpay_order_id = gateway_order["id"]
        payment.amount = order.total_amount
        payment.status = Payment.Status.PENDING
        payment.save(update_fields=["razorpay_order_id", "amount", "status", "updated_at"])
        order.status = Order.Status.PAYMENT_PENDING
        order.save(update_fields=["status", "updated_at"])
        return Response(
            {
                "razorpay_order_id": gateway_order["id"],
                "amount": amount_paise,
                "currency": "INR",
                "order_id": order.id,
                "key": settings.RAZORPAY_KEY_ID,
            }
        )


class RazorpayVerifyView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = "payment"

    def post(self, request):
        serializer = RazorpayVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if not verify_payment_signature(data["razorpay_order_id"], data["razorpay_payment_id"], data["razorpay_signature"]):
            return Response({"detail": "Payment signature verification failed"}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            payment = get_object_or_404(
                Payment.objects.select_for_update().select_related("order", "order__user"),
                razorpay_order_id=data["razorpay_order_id"],
                order__user=request.user,
            )
            try:
                order = capture_razorpay_payment(
                    payment,
                    razorpay_payment_id=data["razorpay_payment_id"],
                    razorpay_signature=data["razorpay_signature"],
                    hmac_verified=True,
                )
            except ValueError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"message": "Payment verified", "order_number": order.order_number, "order_id": order.id})


class RazorpayWebhookView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        body = request.body
        signature = request.headers.get("X-Razorpay-Signature", "")
        if not verify_webhook_signature(body, signature):
            return Response({"detail": "Invalid webhook signature"}, status=status.HTTP_400_BAD_REQUEST)
        payload = request.data
        event_id = payload.get("id") or f"{payload.get('event', 'event')}-{payload.get('created_at', timezone.now().timestamp())}"
        event, created = RazorpayWebhookEvent.objects.get_or_create(
            event_id=event_id,
            defaults={"event_type": payload.get("event", ""), "payload": payload},
        )
        if not created and event.processed_at:
            return Response({"status": "duplicate"})

        event_type = payload.get("event", "")
        payload_root = payload.get("payload", {})
        entity = payload_root.get("payment", {}).get("entity", {})
        refund_entity = payload_root.get("refund", {}).get("entity", {})
        rz_order_id = entity.get("order_id")
        payment = Payment.objects.filter(razorpay_order_id=rz_order_id).select_related("order", "order__user").first()
        if payment and event_type == "payment.captured":
            with transaction.atomic():
                payment = Payment.objects.select_for_update().select_related("order", "order__user").get(id=payment.id)
                try:
                    capture_razorpay_payment(
                        payment,
                        razorpay_payment_id=entity.get("id", payment.razorpay_payment_id or ""),
                        hmac_verified=True,
                    )
                except ValueError:
                    pass
        elif payment and event_type == "payment.failed":
            payment.status = Payment.Status.FAILED
            payment.save(update_fields=["status", "updated_at"])
            record_tracking_event(payment.order, ShipmentEvent.Status.PAYMENT_PENDING, description="Payment failed. Customer can retry checkout.")
        elif event_type.startswith("refund.") and refund_entity:
            payment_id = refund_entity.get("payment_id", "")
            payment = Payment.objects.filter(razorpay_payment_id=payment_id).select_related("order", "order__user").first()
            if payment:
                amount = Decimal(str(refund_entity.get("amount", 0))) / Decimal("100")
                try:
                    with transaction.atomic():
                        locked = Payment.objects.select_for_update().select_related("order", "order__user").get(id=payment.id)
                        apply_refund_reconciliation(
                            payment=locked,
                            amount=amount,
                            refund_id=refund_entity.get("id", ""),
                            source="razorpay.webhook",
                        )
                except PaymentReconciliationError:
                    # Mirrors the payment.captured branch above: a reconciliation refusal is a
                    # permanent condition for this event, so swallow it and still mark the event
                    # processed. Letting it escape returned 500 and left processed_at unset, so
                    # Razorpay retried the same event forever.
                    logger.exception(
                        "Refund reconciliation refused for webhook event %s (payment %s)",
                        event_id,
                        payment.id,
                    )

        event.processed_at = timezone.now()
        event.save(update_fields=["processed_at"])
        return Response({"status": "ok"})


class RefundView(APIView):
    permission_classes = [IsStaffAdmin]

    def post(self, request):
        serializer = RefundSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payment = get_object_or_404(
            Payment.objects.select_related("order", "order__user"),
            order_id=serializer.validated_data["order_id"],
        )
        requested_amount = serializer.validated_data.get("amount")
        # `or` would treat an explicit 0 as "not supplied" and silently refund the whole
        # remaining balance, so test for None instead.
        amount = requested_amount if requested_amount is not None else (payment.amount - payment.refunded_amount)
        try:
            with transaction.atomic():
                payment = Payment.objects.select_for_update().select_related("order", "order__user").get(id=payment.id)
                if payment.status not in {Payment.Status.CAPTURED, Payment.Status.PARTIALLY_REFUNDED, Payment.Status.REFUNDED}:
                    raise PaymentReconciliationError("Only captured payments can be refunded.")
                # Validate the amount BEFORE calling the gateway. refund_gateway_payment moves real
                # money and cannot be rolled back, so letting apply_refund_reconciliation reject it
                # afterwards would leave money out the door with no local record.
                validate_refund_amount(payment=payment, amount=amount)
                refund_id = ""
                provider_status = "manual"
                if payment.order.payment_method == Order.PaymentMethod.RAZORPAY:
                    if not payment.razorpay_payment_id:
                        raise PaymentReconciliationError("Cannot refund Razorpay order because payment id is missing.")
                    refund = refund_gateway_payment(payment_id=payment.razorpay_payment_id, amount=amount)
                    refund_id = refund.get("id", "")
                    provider_status = refund.get("status", "")
                else:
                    refund_id = f"manual-cod-{payment.order.order_number}"
                payment = apply_refund_reconciliation(payment=payment, amount=amount, refund_id=refund_id, source="admin.refund")
            record_admin_audit(
                request,
                action="payment.refund",
                entity=payment,
                summary=f"Refund of ₹{amount} recorded for {payment.order.order_number}.",
                metadata={"amount": str(amount), "refund_id": refund_id, "refund_status": payment.status, "provider_status": provider_status},
            )
            return Response({"message": "Refund recorded", "refund_id": payment.refund_id, "provider_status": provider_status, "status": payment.status})
        except PaymentReconciliationError as exc:
            record_admin_audit(
                request,
                action="payment.refund_rejected",
                entity=payment,
                summary=f"Refund rejected for {payment.order.order_number}: {exc}",
                metadata={"amount": str(amount), "reason": str(exc)},
            )
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except PaymentGatewayError as exc:
            record_admin_audit(
                request,
                action="payment.refund_failed",
                entity=payment,
                summary=f"Refund gateway failed for {payment.order.order_number}: {exc}",
                metadata={"amount": str(amount), "reason": str(exc)},
            )
            return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

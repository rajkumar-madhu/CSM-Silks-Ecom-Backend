from __future__ import annotations

import hashlib
import hmac
import uuid
from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings


class PaymentGatewayError(RuntimeError):
    pass


class PaymentReconciliationError(ValueError):
    pass


def payment_dev_fallback_enabled() -> bool:
    return bool(settings.DEBUG and settings.PAYMENT_DEV_FALLBACK_ENABLED)


def razorpay_checkout_configured() -> bool:
    return bool(settings.RAZORPAY_KEY_ID and settings.RAZORPAY_KEY_SECRET) or payment_dev_fallback_enabled()


def create_gateway_order(amount_paise: int, receipt: str, notes: dict | None = None) -> dict:
    if not settings.RAZORPAY_KEY_ID or not settings.RAZORPAY_KEY_SECRET:
        if not payment_dev_fallback_enabled():
            raise PaymentGatewayError("Razorpay credentials are not configured")
        return {
            "id": f"order_dev_{uuid.uuid4().hex[:16]}",
            "amount": amount_paise,
            "currency": "INR",
            "receipt": receipt,
            "notes": notes or {},
        }
    import razorpay

    client = razorpay.Client(auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET))
    return client.order.create({"amount": amount_paise, "currency": "INR", "receipt": receipt, "notes": notes or {}})


def verify_payment_signature(razorpay_order_id: str, razorpay_payment_id: str, razorpay_signature: str) -> bool:
    if payment_dev_fallback_enabled() and razorpay_signature == "dev":
        if settings.IS_PRODUCTION:
            raise PaymentGatewayError("Development payment fallback cannot be used in production")
        return True
    if not settings.RAZORPAY_KEY_SECRET:
        return False
    message = f"{razorpay_order_id}|{razorpay_payment_id}"
    expected = hmac.new(settings.RAZORPAY_KEY_SECRET.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, razorpay_signature)


def verify_webhook_signature(payload_bytes: bytes, signature: str) -> bool:
    if payment_dev_fallback_enabled() and signature == "dev":
        if settings.IS_PRODUCTION:
            raise PaymentGatewayError("Development payment fallback cannot be used in production")
        return True
    if not settings.RAZORPAY_WEBHOOK_SECRET:
        return False
    expected = hmac.new(settings.RAZORPAY_WEBHOOK_SECRET.encode("utf-8"), payload_bytes, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def refund_gateway_payment(*, payment_id: str, amount: Decimal) -> dict:
    if not settings.RAZORPAY_KEY_ID or not settings.RAZORPAY_KEY_SECRET or not payment_id:
        if not payment_dev_fallback_enabled():
            raise PaymentGatewayError("Razorpay refund credentials/payment id are not configured")
        return {"id": f"refund_dev_{uuid.uuid4().hex[:16]}", "status": "processed", "amount": int(amount * 100)}

    import razorpay

    client = razorpay.Client(auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET))
    return client.payment.refund(payment_id, {"amount": int(amount * 100), "speed": "normal"})


def money(value: Decimal | int | str) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def payment_known_refunds(payment) -> list[str]:
    return [item.strip() for item in (payment.refund_id or "").split(",") if item.strip()]


def append_refund_id(payment, refund_id: str) -> None:
    refund_id = (refund_id or "").strip()
    if not refund_id:
        return
    known = payment_known_refunds(payment)
    if refund_id not in known:
        known.append(refund_id)
    payment.refund_id = ",".join(known)


def validate_refund_amount(*, payment, amount: Decimal) -> Decimal:
    """Reject a refund amount before any irreversible gateway call is made.

    Callers that talk to the payment provider must run this first — the provider
    moves real money and a later PaymentReconciliationError only rolls back the
    local transaction, not the refund.
    """
    amount = money(amount)
    if amount <= 0:
        raise PaymentReconciliationError("Refund amount must be greater than zero.")
    if payment.status not in {payment.Status.CAPTURED, payment.Status.PARTIALLY_REFUNDED, payment.Status.REFUNDED}:
        raise PaymentReconciliationError("Only captured payments can be refunded.")
    remaining = money(payment.amount - payment.refunded_amount)
    if amount > remaining:
        raise PaymentReconciliationError(f"Refund amount exceeds remaining refundable balance of ₹{remaining}.")
    return amount


def apply_refund_reconciliation(*, payment, amount: Decimal, refund_id: str = "", source: str = "manual"):
    from notifications.services import create_notification
    from orders.models import Order
    from shipping.models import ShipmentEvent
    from shipping.services import record_tracking_event

    amount = money(amount)
    # Replaying a refund we have already recorded is a no-op, so check that before
    # validating the amount — a duplicate webhook must not raise "exceeds balance".
    if refund_id and refund_id in payment_known_refunds(payment):
        return payment
    amount = validate_refund_amount(payment=payment, amount=amount)

    payment.refunded_amount = money(payment.refunded_amount + amount)
    append_refund_id(payment, refund_id)
    full_refund = payment.refunded_amount >= payment.amount
    payment.status = payment.Status.REFUNDED if full_refund else payment.Status.PARTIALLY_REFUNDED
    payment.save(update_fields=["refunded_amount", "status", "refund_id", "updated_at"])

    order = payment.order
    if full_refund:
        order.status = Order.Status.REFUNDED
        order.save(update_fields=["status", "updated_at"])

    description = (
        f"Full refund of ₹{payment.refunded_amount} recorded."
        if full_refund
        else f"Partial refund of ₹{amount} recorded. Remaining refundable balance ₹{money(payment.amount - payment.refunded_amount)}."
    )
    record_tracking_event(order, ShipmentEvent.Status.REFUNDED, description=description, raw_payload={"source": source, "refund_id": refund_id})
    create_notification(
        user=order.user,
        title="Refund recorded" if full_refund else "Partial refund recorded",
        body=f"{description} Order {order.order_number}.",
        notification_type="order",
        data={"order_id": order.id, "order_number": order.order_number, "refund_id": refund_id, "amount": str(amount)},
    )
    return payment

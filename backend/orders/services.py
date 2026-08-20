from __future__ import annotations

import uuid
from datetime import timedelta
from decimal import Decimal

from django.db.models import F, Max, Value
from django.db.models.functions import Greatest
from django.db import transaction
from django.utils import timezone

from accounts.models import Address
from cart.models import Cart
from catalog.models import Product, ProductVariant
from inventory.models import StockLedger, StockReservation
from loyalty.models import LoyaltyTransaction
from notifications.services import create_notification
from payments.models import Payment

from .models import Order, OrderItem, ReturnRequest
from .pricing import calculate_coupon_discount, calculate_gst, calculate_loyalty_points, finishing_line_fee, mark_coupon_used, quote_cart_totals, shipping_amount, unmark_coupon_used


def generate_order_number() -> str:
    return f"CSM-{timezone.now():%Y%m%d}-{str(uuid.uuid4().int)[:5]}"


def address_snapshot(address: Address) -> dict:
    return {
        "full_name": address.full_name,
        "email": address.email,
        "phone": address.phone,
        "address_line_1": address.address_line_1,
        "address_line_2": address.address_line_2,
        "city": address.city,
        "state": address.state,
        "pin_code": address.pin_code,
        "country": address.country,
    }


def _validate_checkout_address(address: Address) -> None:
    required = {
        "full_name": address.full_name,
        "phone": address.phone,
        "address_line_1": address.address_line_1,
        "city": address.city,
        "state": address.state,
        "pin_code": address.pin_code,
    }
    missing = [field for field, value in required.items() if not str(value or "").strip()]
    if missing:
        raise ValueError("Selected delivery address is incomplete. Please update full address details before placing order.")


@transaction.atomic
def create_order_from_cart(
    user,
    address_id: int,
    coupon_code: str = "",
    loyalty_points_to_use: int = 0,
    payment_method: str = Order.PaymentMethod.COD,
    occasion_note: str = "",
    finishing: list | None = None,
) -> Order:
    cart = Cart.objects.select_for_update().prefetch_related("items__variant", "items__product").get(user=user)
    items = list(cart.items.select_related("product", "variant"))
    if not items:
        raise ValueError("Cart is empty")
    try:
        address = Address.objects.get(id=address_id, user=user)
    except Address.DoesNotExist as exc:
        raise ValueError("Delivery address not found") from exc
    _validate_checkout_address(address)

    variant_ids = [item.variant_id for item in items]
    locked_variants = {
        variant.id: variant
        for variant in ProductVariant.objects.select_for_update()
        .select_related("product")
        .filter(id__in=variant_ids)
    }
    for item in items:
        variant = locked_variants.get(item.variant_id)
        if not variant or variant.available_qty < item.quantity:
            raise ValueError(f"Insufficient stock for {item.product.name}")

    # Shared with the /api/cart/quote endpoint so the checkout figure the customer
    # approves is computed by exactly this code and cannot drift from what we charge.
    quote = quote_cart_totals(
        items=items,
        finishing=finishing,
        coupon_code=coupon_code or cart.coupon_code,
        loyalty_points_to_use=loyalty_points_to_use,
        available_loyalty_points=user.loyalty_points,
    )
    finishing_total = quote["finishing_total"]
    item_finishing = quote["item_finishing"]
    subtotal = quote["subtotal"]
    coupon_discount = quote["coupon_discount"]
    loyalty_discount = quote["loyalty_discount"]
    cgst, sgst = quote["cgst"], quote["sgst"]
    shipping = quote["shipping"]
    total = quote["total"]
    points_earned = quote["loyalty_points_earned"]
    status = Order.Status.CONFIRMED if payment_method == Order.PaymentMethod.COD else Order.Status.PAYMENT_PENDING

    order = Order.objects.create(
        order_number=generate_order_number(),
        user=user,
        address=address,
        subtotal=subtotal,
        discount_amount=coupon_discount + loyalty_discount,
        coupon_code=coupon_code or cart.coupon_code,
        cgst_amount=cgst,
        sgst_amount=sgst,
        shipping_amount=shipping,
        total_amount=total,
        status=status,
        payment_method=payment_method,
        shipping_address_snapshot=address_snapshot(address),
        loyalty_points_earned=points_earned,
        loyalty_points_used=int(loyalty_discount),
        finishing_amount=finishing_total,
        occasion_note=(occasion_note or "")[:200],
        confirmed_at=timezone.now() if status == Order.Status.CONFIRMED else None,
    )

    for item in items:
        variant = item.variant
        OrderItem.objects.create(
            order=order,
            product=item.product,
            variant=variant,
            product_name=item.product.name,
            product_sku=variant.sku,
            variant_title=variant.title,
            unit_price=variant.price,
            quantity=item.quantity,
            subtotal=variant.price * item.quantity,
            selected_colour=variant.color_name,
            blouse_stitching=item_finishing[item.id]["blouse_stitching"],
            blouse_size=item_finishing[item.id]["blouse_size"],
            fall_pico=item_finishing[item.id]["fall_pico"],
        )
        if payment_method == Order.PaymentMethod.COD:
            variant.mark_sold(item.quantity)
            item.product.total_sold += item.quantity
            item.product.save(update_fields=["total_sold", "updated_at"])
            StockLedger.objects.create(variant=variant, quantity_delta=-item.quantity, reason=StockLedger.Reason.SALE, reference=order.order_number)
            from catalog.realtime import publish_product_update

            publish_product_update(variant.product, event_type="inventory.variant.updated", variant=variant, source="order.cod.sale")
        else:
            variant.reserved_qty += item.quantity
            variant.save(update_fields=["reserved_qty", "updated_at"])
            StockReservation.objects.create(
                variant=variant,
                user=user,
                quantity=item.quantity,
                order_number=order.order_number,
                expires_at=timezone.now() + timedelta(minutes=20),
            )
            StockLedger.objects.create(variant=variant, quantity_delta=-item.quantity, reason=StockLedger.Reason.RESERVATION, reference=order.order_number)
            from catalog.realtime import publish_product_update

            publish_product_update(variant.product, event_type="inventory.variant.updated", variant=variant, source="order.reservation")

    if loyalty_discount:
        user.loyalty_points -= int(loyalty_discount)
        LoyaltyTransaction.objects.create(
            user=user,
            order_id=order.id,
            transaction_type=LoyaltyTransaction.Type.REDEEM,
            points=-int(loyalty_discount),
            balance_after=user.loyalty_points,
            description=f"Points redeemed on {order.order_number}",
        )
    if status == Order.Status.CONFIRMED:
        if coupon_discount:
            mark_coupon_used(order.coupon_code)
        user.loyalty_points += points_earned
        LoyaltyTransaction.objects.create(
            user=user,
            order_id=order.id,
            transaction_type=LoyaltyTransaction.Type.EARN,
            points=points_earned,
            balance_after=user.loyalty_points,
            description=f"Points earned from {order.order_number}",
        )
    user.save(update_fields=["loyalty_points"])

    Payment.objects.create(
        order=order,
        amount=total,
        method=Payment.Method.COD if payment_method == Order.PaymentMethod.COD else "",
        status=Payment.Status.CAPTURED if payment_method == Order.PaymentMethod.COD else Payment.Status.PENDING,
        paid_at=timezone.now() if payment_method == Order.PaymentMethod.COD else None,
    )
    create_notification(
        user=user,
        title="Order placed",
        body=f"Your CSM Silks order {order.order_number} has been placed.",
        notification_type="order",
        data={"order_id": order.id, "order_number": order.order_number},
    )
    from shipping.models import ShipmentEvent
    from shipping.services import record_tracking_event

    record_tracking_event(order, ShipmentEvent.Status.ORDER_PLACED)
    record_tracking_event(
        order,
        ShipmentEvent.Status.CONFIRMED if status == Order.Status.CONFIRMED else ShipmentEvent.Status.PAYMENT_PENDING,
    )
    cart.items.all().delete()
    cart.coupon_code = ""
    cart.save(update_fields=["coupon_code", "updated_at"])
    return order


def _publish_inventory_change(variant, *, source: str) -> None:
    from catalog.realtime import publish_product_update

    publish_product_update(variant.product, event_type="inventory.variant.updated", variant=variant, source=source)


def _release_order_reservations(order: Order, *, actor=None) -> bool:
    reservations = list(
        StockReservation.objects.select_for_update()
        .select_related("variant", "variant__product")
        .filter(order_number=order.order_number, released_at__isnull=True)
    )
    if not reservations:
        return False

    released_at = timezone.now()
    for reservation in reservations:
        variant = reservation.variant
        variant.reserved_qty = max(0, variant.reserved_qty - reservation.quantity)
        variant.save(update_fields=["reserved_qty", "updated_at"])
        reservation.released_at = released_at
        reservation.save(update_fields=["released_at"])
        StockLedger.objects.create(
            variant=variant,
            quantity_delta=reservation.quantity,
            reason=StockLedger.Reason.RELEASE,
            reference=order.order_number,
            note="Reservation released because order was cancelled.",
            created_by=actor if getattr(actor, "is_authenticated", False) else None,
        )
        _publish_inventory_change(variant, source="order.cancel.release")
    return True


def _restock_variant(variant, product, quantity: int) -> None:
    """Return `quantity` units to stock without a read-modify-write race.

    Callers hold a lock on the Order row but not on the variant, while
    create_order_from_cart decrements the same rows under select_for_update.
    Reading stock_qty into Python and writing it back would silently drop a
    concurrent purchase's decrement (inflating stock, then overselling), so let
    the database do the arithmetic and re-read for the realtime publish.
    """
    ProductVariant.objects.filter(pk=variant.pk).update(
        stock_qty=F("stock_qty") + quantity, updated_at=timezone.now()
    )
    Product.objects.filter(pk=product.pk).update(
        total_sold=Greatest(F("total_sold") - quantity, Value(0)), updated_at=timezone.now()
    )
    variant.refresh_from_db(fields=["stock_qty"])
    product.refresh_from_db(fields=["total_sold"])


def _restock_order_items(order: Order, *, actor=None) -> None:
    for item in order.items.select_related("product", "variant", "variant__product"):
        variant = item.variant
        product = item.product
        _restock_variant(variant, product, item.quantity)
        StockLedger.objects.create(
            variant=variant,
            quantity_delta=item.quantity,
            reason=StockLedger.Reason.RETURN,
            reference=order.order_number,
            note="Stock restored because order was cancelled before fulfillment.",
            created_by=actor if getattr(actor, "is_authenticated", False) else None,
        )
        _publish_inventory_change(variant, source="order.cancel.restock")


def _reverse_order_loyalty(order: Order, *, was_confirmed: bool) -> None:
    user = order.user
    changed = False
    if was_confirmed and order.loyalty_points_earned:
        user.loyalty_points = max(0, user.loyalty_points - order.loyalty_points_earned)
        LoyaltyTransaction.objects.create(
            user=user,
            order_id=order.id,
            transaction_type=LoyaltyTransaction.Type.REDEEM,
            points=-order.loyalty_points_earned,
            balance_after=user.loyalty_points,
            description=f"Points reversed because {order.order_number} was cancelled",
        )
        changed = True
    if order.loyalty_points_used:
        user.loyalty_points += order.loyalty_points_used
        LoyaltyTransaction.objects.create(
            user=user,
            order_id=order.id,
            transaction_type=LoyaltyTransaction.Type.BONUS,
            points=order.loyalty_points_used,
            balance_after=user.loyalty_points,
            description=f"Points restored because {order.order_number} was cancelled",
        )
        changed = True
    if changed:
        user.save(update_fields=["loyalty_points"])


def _reverse_order_loyalty_once(order: Order, *, marker: str, reason: str) -> None:
    if LoyaltyTransaction.objects.filter(user=order.user, order_id=order.id, description__icontains=marker).exists():
        return

    user = order.user
    changed = False
    if order.loyalty_points_earned:
        user.loyalty_points = max(0, user.loyalty_points - order.loyalty_points_earned)
        LoyaltyTransaction.objects.create(
            user=user,
            order_id=order.id,
            transaction_type=LoyaltyTransaction.Type.REDEEM,
            points=-order.loyalty_points_earned,
            balance_after=user.loyalty_points,
            description=f"Points reversed because {order.order_number} was {reason} [{marker}]",
        )
        changed = True
    if order.loyalty_points_used:
        user.loyalty_points += order.loyalty_points_used
        LoyaltyTransaction.objects.create(
            user=user,
            order_id=order.id,
            transaction_type=LoyaltyTransaction.Type.BONUS,
            points=order.loyalty_points_used,
            balance_after=user.loyalty_points,
            description=f"Points restored because {order.order_number} was {reason} [{marker}]",
        )
        changed = True
    if changed:
        user.save(update_fields=["loyalty_points"])


FULFILLMENT_WORKFLOW_ACTIONS = {
    "quality_check",
    "pack",
    "create_label",
    "pickup",
    "in_transit",
    "out_for_delivery",
    "delivery_failed",
    "rto_initiated",
    "rto_delivered",
    "delivered",
}


def order_payment_is_captured(order: Order) -> bool:
    payment = getattr(order, "payment", None)
    return bool(payment and payment.status == Payment.Status.CAPTURED)


POST_PAYMENT_STATUSES = {
    Order.Status.CONFIRMED,
    Order.Status.QUALITY_CHECK,
    Order.Status.PACKED,
    Order.Status.SHIPPED,
    Order.Status.OUT_FOR_DELIVERY,
    Order.Status.DELIVERED,
    Order.Status.DELIVERY_FAILED,
    Order.Status.RTO_INITIATED,
    Order.Status.RTO_DELIVERED,
}


def validate_admin_status_change(order: Order, new_status: str) -> None:
    if new_status == order.status:
        return
    if order.payment_method == Order.PaymentMethod.RAZORPAY:
        if new_status == Order.Status.CONFIRMED and order.status == Order.Status.PAYMENT_PENDING:
            raise ValueError("Confirm Razorpay orders only after payment capture.")
        if new_status in POST_PAYMENT_STATUSES and not order_payment_is_captured(order):
            raise ValueError("Cannot update Razorpay order status before payment is captured.")


def validate_admin_workflow_action(order: Order, action: str) -> None:
    if action == "cancel":
        return
    if order.status == Order.Status.CANCELLED:
        raise ValueError("Cannot update a cancelled order.")
    if order.status in {Order.Status.RETURN_INITIATED, Order.Status.RETURNED, Order.Status.REFUNDED}:
        raise ValueError(f"Cannot run fulfillment workflow while order is {order.status}.")

    if order.payment_method == Order.PaymentMethod.RAZORPAY and not order_payment_is_captured(order):
        if action == "confirm":
            raise ValueError("Cannot confirm unpaid Razorpay order. Wait for verified payment or webhook capture.")
        if action in FULFILLMENT_WORKFLOW_ACTIONS:
            raise ValueError("Cannot start fulfillment before Razorpay payment is captured.")

    if action in FULFILLMENT_WORKFLOW_ACTIONS and order.status in {Order.Status.PENDING, Order.Status.PAYMENT_PENDING}:
        raise ValueError("Cannot start fulfillment before payment/order confirmation.")


def _return_window_days(order: Order) -> int:
    return order.items.aggregate(max_days=Max("product__return_days"))["max_days"] or 0


def validate_return_request(order: Order) -> None:
    if order.status != Order.Status.DELIVERED:
        raise ValueError("Returns can be requested only after the order is delivered.")
    if not order.delivered_at:
        raise ValueError("Delivery timestamp is missing; return cannot be validated.")
    return_days = _return_window_days(order)
    if return_days and timezone.now() > order.delivered_at + timedelta(days=return_days):
        raise ValueError(f"Return window expired after {return_days} days.")
    if order.returns.exclude(status=ReturnRequest.Status.REJECTED).exists():
        raise ValueError("An active return request already exists for this order.")


@transaction.atomic
def create_return_request(*, order: Order, user, reason: str, details: str = "") -> ReturnRequest:
    order = (
        Order.objects.select_for_update()
        .prefetch_related("items__product", "returns")
        .get(id=order.id, user=user)
    )
    validate_return_request(order)
    ret = ReturnRequest.objects.create(order=order, user=user, reason=reason, details=details)
    order.status = Order.Status.RETURN_INITIATED
    order.save(update_fields=["status", "updated_at"])
    from shipping.services import record_order_status_event

    record_order_status_event(order, note="Return request raised from customer orders page.")
    create_notification(
        user=user,
        title="Return requested",
        body=f"Your return request for {order.order_number} has been created.",
        notification_type="order",
        data={"order_id": order.id, "order_number": order.order_number, "return_id": ret.id},
    )
    return ret


def _restock_return_items_once(order: Order, *, actor=None) -> bool:
    reference = f"{order.order_number}:return"
    if StockLedger.objects.filter(reason=StockLedger.Reason.RETURN, reference=reference).exists():
        return False
    for item in order.items.select_related("product", "variant", "variant__product"):
        variant = item.variant
        product = item.product
        _restock_variant(variant, product, item.quantity)
        StockLedger.objects.create(
            variant=variant,
            quantity_delta=item.quantity,
            reason=StockLedger.Reason.RETURN,
            reference=reference,
            note="Stock restored after return refund.",
            created_by=actor if getattr(actor, "is_authenticated", False) else None,
        )
        _publish_inventory_change(variant, source="order.return.restock")
    return True


def _refund_order_payment_once(order: Order) -> None:
    payment = getattr(order, "payment", None)
    if not payment:
        return
    if payment.status == Payment.Status.REFUNDED and payment.refunded_amount >= order.total_amount:
        return

    refund_id = payment.refund_id
    if order.payment_method == Order.PaymentMethod.RAZORPAY:
        if not payment.razorpay_payment_id:
            raise ValueError("Cannot refund Razorpay order because payment id is missing.")
        from payments.services import PaymentGatewayError, refund_gateway_payment

        try:
            refund = refund_gateway_payment(payment_id=payment.razorpay_payment_id, amount=order.total_amount)
        except PaymentGatewayError as exc:
            raise ValueError(str(exc)) from exc
        refund_id = refund.get("id", "")
    elif not refund_id:
        refund_id = f"manual-cod-{order.order_number}"

    payment.refunded_amount = order.total_amount
    payment.status = Payment.Status.REFUNDED
    payment.refund_id = refund_id
    payment.save(update_fields=["refunded_amount", "status", "refund_id", "updated_at"])


@transaction.atomic
def update_return_status(ret: ReturnRequest, *, next_status: str, actor=None) -> ReturnRequest:
    ret = (
        ReturnRequest.objects.select_for_update()
        .select_related("order", "order__user", "order__payment", "user")
        .prefetch_related("order__items__product", "order__items__variant", "order__items__variant__product")
        .get(id=ret.id)
    )
    if ret.status == next_status and next_status == ReturnRequest.Status.REFUNDED:
        return ret

    order = ret.order
    if next_status == ReturnRequest.Status.APPROVED:
        ret.status = ReturnRequest.Status.APPROVED
        order.status = Order.Status.RETURN_INITIATED
        order.save(update_fields=["status", "updated_at"])
        ret.save(update_fields=["status", "updated_at"])
        from shipping.services import record_order_status_event

        record_order_status_event(order, note="Return request approved by admin.")
    elif next_status == ReturnRequest.Status.PICKED_UP:
        ret.status = ReturnRequest.Status.PICKED_UP
        order.status = Order.Status.RETURN_INITIATED
        order.save(update_fields=["status", "updated_at"])
        ret.save(update_fields=["status", "updated_at"])
        from shipping.models import ShipmentEvent
        from shipping.services import record_tracking_event

        record_tracking_event(order, ShipmentEvent.Status.RETURN_REQUESTED, description="Return item picked up and moving back to CSM Silks.")
    elif next_status == ReturnRequest.Status.REJECTED:
        ret.status = ReturnRequest.Status.REJECTED
        if order.status == Order.Status.RETURN_INITIATED:
            order.status = Order.Status.DELIVERED
            order.save(update_fields=["status", "updated_at"])
        ret.save(update_fields=["status", "updated_at"])
        from shipping.services import record_order_status_event

        record_order_status_event(order, note="Return request rejected; order remains delivered.")
    elif next_status == ReturnRequest.Status.REFUNDED:
        _refund_order_payment_once(order)
        _restock_return_items_once(order, actor=actor)
        _reverse_order_loyalty_once(order, marker="return-refund", reason="refunded after return")
        ret.status = ReturnRequest.Status.REFUNDED
        order.status = Order.Status.REFUNDED
        order.save(update_fields=["status", "updated_at"])
        ret.save(update_fields=["status", "updated_at"])
        from shipping.services import record_order_status_event

        record_order_status_event(order, note="Refund has been recorded by admin.")
        create_notification(
            user=order.user,
            title="Return refunded",
            body=f"Refund has been recorded for {order.order_number}.",
            notification_type="order",
            data={"order_id": order.id, "order_number": order.order_number, "return_id": ret.id},
        )
    else:
        raise ValueError(f"Unsupported return status {next_status}.")
    return ret


@transaction.atomic
def cancel_order(order: Order, *, actor=None, note: str = "", location: str = "") -> Order:
    order = (
        Order.objects.select_for_update()
        .select_related("user", "payment")
        .prefetch_related("items__product", "items__variant", "items__variant__product")
        .get(id=order.id)
    )
    if order.status == Order.Status.CANCELLED:
        return order
    cancellable_statuses = {Order.Status.PENDING, Order.Status.PAYMENT_PENDING, Order.Status.CONFIRMED}
    if order.status not in cancellable_statuses:
        raise ValueError(f"Cannot cancel order in {order.status} status")

    previous_status = order.status
    released_reservations = _release_order_reservations(order, actor=actor)
    if previous_status == Order.Status.CONFIRMED and not released_reservations:
        _restock_order_items(order, actor=actor)
    _reverse_order_loyalty(order, was_confirmed=previous_status == Order.Status.CONFIRMED)
    if previous_status == Order.Status.CONFIRMED and order.coupon_code:
        unmark_coupon_used(order.coupon_code)

    payment = getattr(order, "payment", None)
    if payment and payment.status == Payment.Status.PENDING:
        payment.status = Payment.Status.FAILED
        payment.save(update_fields=["status", "updated_at"])

    order.status = Order.Status.CANCELLED
    order.save(update_fields=["status", "updated_at"])

    from shipping.services import record_order_status_event

    record_order_status_event(order, note=note or "Order cancelled before fulfillment.", location=location)
    create_notification(
        user=order.user,
        title="Order cancelled",
        body=f"Your CSM Silks order {order.order_number} has been cancelled.",
        notification_type="order",
        data={"order_id": order.id, "order_number": order.order_number},
    )
    return order


@transaction.atomic
def confirm_paid_order(order: Order) -> Order:
    if order.status == Order.Status.CONFIRMED:
        return order
    reservations = StockReservation.objects.select_related("variant", "variant__product").filter(order_number=order.order_number, released_at__isnull=True)
    for reservation in reservations:
        variant = reservation.variant
        variant.reserved_qty = max(0, variant.reserved_qty - reservation.quantity)
        variant.stock_qty = max(0, variant.stock_qty - reservation.quantity)
        variant.last_sold_at = timezone.now()
        variant.save(update_fields=["reserved_qty", "stock_qty", "last_sold_at", "updated_at"])
        variant.product.total_sold += reservation.quantity
        variant.product.save(update_fields=["total_sold", "updated_at"])
        reservation.released_at = timezone.now()
        reservation.save(update_fields=["released_at"])
        from catalog.realtime import publish_product_update

        publish_product_update(variant.product, event_type="inventory.variant.updated", variant=variant, source="order.payment.capture")
    order.status = Order.Status.CONFIRMED
    order.confirmed_at = timezone.now()
    order.save(update_fields=["status", "confirmed_at", "updated_at"])
    from shipping.models import ShipmentEvent
    from shipping.services import record_tracking_event

    record_tracking_event(order, ShipmentEvent.Status.CONFIRMED, description="Payment captured and order confirmed.")
    if order.coupon_code and order.discount_amount:
        mark_coupon_used(order.coupon_code)
    user = order.user
    user.loyalty_points += order.loyalty_points_earned
    user.save(update_fields=["loyalty_points"])
    LoyaltyTransaction.objects.create(
        user=user,
        order_id=order.id,
        transaction_type=LoyaltyTransaction.Type.EARN,
        points=order.loyalty_points_earned,
        balance_after=user.loyalty_points,
        description=f"Points earned from {order.order_number}",
    )
    create_notification(
        user=user,
        title="Order confirmed",
        body=f"Payment received for {order.order_number}. Your textile is moving to quality check.",
        notification_type="order",
        data={"order_id": order.id, "order_number": order.order_number},
    )
    return order


def _apply_confirmed_order_loyalty(order: Order) -> None:
    user = order.user
    if order.coupon_code and order.discount_amount:
        mark_coupon_used(order.coupon_code)
    if order.loyalty_points_earned:
        user.loyalty_points += order.loyalty_points_earned
        user.save(update_fields=["loyalty_points"])
        LoyaltyTransaction.objects.create(
            user=user,
            order_id=order.id,
            transaction_type=LoyaltyTransaction.Type.EARN,
            points=order.loyalty_points_earned,
            balance_after=user.loyalty_points,
            description=f"Points earned from {order.order_number}",
        )


def _redeem_order_loyalty_on_recovery(order: Order) -> None:
    if not order.loyalty_points_used:
        return
    user = order.user
    user.loyalty_points = max(0, user.loyalty_points - order.loyalty_points_used)
    user.save(update_fields=["loyalty_points"])
    LoyaltyTransaction.objects.create(
        user=user,
        order_id=order.id,
        transaction_type=LoyaltyTransaction.Type.REDEEM,
        points=-order.loyalty_points_used,
        balance_after=user.loyalty_points,
        description=f"Points redeemed on recovered payment for {order.order_number}",
    )


def _auto_refund_overcapture(order: Order) -> None:
    payment = getattr(order, "payment", None)
    if not payment or payment.status != Payment.Status.CAPTURED:
        return
    try:
        _refund_order_payment_once(order)
    except ValueError:
        return
    create_notification(
        user=order.user,
        title="Refund initiated",
        body=f"Payment for {order.order_number} could not be fulfilled after expiry. A refund has been initiated.",
        notification_type="order",
        data={"order_id": order.id, "order_number": order.order_number},
    )


@transaction.atomic
def recover_cancelled_paid_order(order: Order) -> Order:
    order = (
        Order.objects.select_for_update()
        .select_related("user", "payment")
        .prefetch_related("items__product", "items__variant", "items__variant__product")
        .get(id=order.id)
    )
    if order.status == Order.Status.CONFIRMED:
        return order

    for item in order.items.select_related("variant", "variant__product"):
        variant = ProductVariant.objects.select_for_update().get(id=item.variant_id)
        if variant.available_qty < item.quantity:
            _auto_refund_overcapture(order)
            raise ValueError("Payment received after order expiry but stock is unavailable; refund has been initiated.")

    for item in order.items.select_related("variant", "variant__product"):
        variant = ProductVariant.objects.select_for_update().get(id=item.variant_id)
        variant.mark_sold(item.quantity)
        item.product.total_sold += item.quantity
        item.product.save(update_fields=["total_sold", "updated_at"])
        StockLedger.objects.create(
            variant=variant,
            quantity_delta=-item.quantity,
            reason=StockLedger.Reason.SALE,
            reference=order.order_number,
            note="Late payment captured after reservation expiry.",
        )
        _publish_inventory_change(variant, source="order.payment.late_capture")

    order.status = Order.Status.CONFIRMED
    order.confirmed_at = timezone.now()
    order.save(update_fields=["status", "confirmed_at", "updated_at"])
    from shipping.models import ShipmentEvent
    from shipping.services import record_tracking_event

    record_tracking_event(order, ShipmentEvent.Status.CONFIRMED, description="Late payment captured and order confirmed.")
    _redeem_order_loyalty_on_recovery(order)
    _apply_confirmed_order_loyalty(order)
    create_notification(
        user=order.user,
        title="Order confirmed",
        body=f"Payment received for {order.order_number}. Your textile is moving to quality check.",
        notification_type="order",
        data={"order_id": order.id, "order_number": order.order_number},
    )
    return order


@transaction.atomic
def capture_razorpay_payment(
    payment: Payment,
    *,
    razorpay_payment_id: str,
    razorpay_signature: str = "",
    hmac_verified: bool = True,
) -> Order:
    payment = Payment.objects.select_for_update().select_related("order", "order__user").get(pk=payment.pk)
    order = (
        Order.objects.select_for_update()
        .select_related("user", "payment")
        .prefetch_related("items__variant", "items__variant__product")
        .get(id=payment.order_id)
    )

    if payment.status == Payment.Status.CAPTURED and order.status == Order.Status.CONFIRMED:
        return order

    payment.razorpay_payment_id = razorpay_payment_id
    if razorpay_signature:
        payment.razorpay_signature = razorpay_signature
    payment.status = Payment.Status.CAPTURED
    payment.is_hmac_verified = hmac_verified
    payment.paid_at = timezone.now()
    payment.save(update_fields=["razorpay_payment_id", "razorpay_signature", "status", "is_hmac_verified", "paid_at", "updated_at"])

    if order.status == Order.Status.CANCELLED:
        return recover_cancelled_paid_order(order)
    if order.status == Order.Status.PAYMENT_PENDING:
        return confirm_paid_order(order)
    if order.status == Order.Status.CONFIRMED:
        return order
    raise ValueError(f"Cannot capture payment for order in {order.status} status")

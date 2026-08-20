from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings
from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone


def money(value: Decimal | int | float | str) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def calculate_gst(subtotal: Decimal) -> tuple[Decimal, Decimal]:
    cgst = money(subtotal * Decimal(str(settings.CGST_RATE)))
    sgst = money(subtotal * Decimal(str(settings.SGST_RATE)))
    return cgst, sgst


def calculate_loyalty_points(order_total: Decimal) -> int:
    return int(order_total * Decimal(str(settings.LOYALTY_POINTS_PER_RUPEE)))


def calculate_coupon_discount(subtotal: Decimal, coupon_code: str = "") -> Decimal:
    code = coupon_code.upper().strip()
    if not code:
        return Decimal("0.00")

    from .models import Coupon

    now = timezone.now()
    coupon = (
        Coupon.objects.filter(code=code, is_active=True)
        .filter(Q(starts_at__isnull=True) | Q(starts_at__lte=now))
        .filter(Q(expires_at__isnull=True) | Q(expires_at__gte=now))
        .first()
    )
    if coupon:
        if subtotal < coupon.min_order_value:
            return Decimal("0.00")
        if coupon.usage_limit is not None and coupon.used_count >= coupon.usage_limit:
            return Decimal("0.00")
        if coupon.discount_type == Coupon.DiscountType.PERCENT:
            return min(money(subtotal * (coupon.value / Decimal("100"))), money(subtotal))
        return min(money(coupon.value), money(subtotal))

    # No hardcoded fallback codes: a code that has no active, in-window Coupon row
    # earns no discount. CSM10/COMEBACK10 used to be granted here unconditionally,
    # which meant deactivating or expiring those rows in admin had no effect and
    # min_order_value was never applied to them.
    return Decimal("0.00")


@transaction.atomic
def mark_coupon_used(coupon_code: str) -> None:
    code = coupon_code.upper().strip()
    if not code:
        return
    from .models import Coupon

    coupon = Coupon.objects.select_for_update().filter(code=code, is_active=True).first()
    if not coupon:
        return
    if coupon.usage_limit is not None and coupon.used_count >= coupon.usage_limit:
        raise ValueError("Coupon usage limit exceeded")
    coupon.used_count += 1
    coupon.save(update_fields=["used_count"])


def unmark_coupon_used(coupon_code: str) -> None:
    code = coupon_code.upper().strip()
    if not code:
        return
    from .models import Coupon

    Coupon.objects.filter(code=code, used_count__gt=0).update(used_count=F("used_count") - 1)


def quote_cart_totals(*, items, finishing: list | None, coupon_code: str, loyalty_points_to_use: int, available_loyalty_points: int) -> dict:
    """Compute checkout totals for a set of cart items.

    Single source of truth for checkout pricing: create_order_from_cart charges what
    this returns and the /api/cart/quote endpoint quotes it, so the figure the customer
    approves cannot drift from the figure they are billed. Raises ValueError with a
    customer-facing message when the finishing selection is invalid.
    """
    finishing_by_item = {int(row.get("cart_item_id")): row for row in (finishing or []) if row.get("cart_item_id")}
    finishing_total = Decimal("0.00")
    item_finishing: dict[int, dict] = {}
    for item in items:
        row = finishing_by_item.get(item.id, {})
        is_saree = item.product.gender == "women"
        stitch = bool(row.get("blouse_stitching")) and is_saree
        pico = bool(row.get("fall_pico")) and is_saree
        size = str(row.get("blouse_size") or "").strip()[:12]
        if stitch and not size:
            raise ValueError("Choose a blouse size when adding stitching.")
        fee = finishing_line_fee(stitch, pico, item.quantity)
        finishing_total += fee
        item_finishing[item.id] = {"blouse_stitching": stitch, "blouse_size": size if stitch else "", "fall_pico": pico}

    goods_subtotal = sum(item.variant.price * item.quantity for item in items)
    subtotal = goods_subtotal + finishing_total
    coupon_discount = calculate_coupon_discount(subtotal, coupon_code)
    loyalty_discount = Decimal(min(loyalty_points_to_use or 0, available_loyalty_points, int(subtotal - coupon_discount)))
    taxable = subtotal - coupon_discount - loyalty_discount
    cgst, sgst = calculate_gst(taxable)
    shipping = shipping_amount(taxable)
    total = taxable + cgst + sgst + shipping
    return {
        "goods_subtotal": money(goods_subtotal),
        "finishing_total": money(finishing_total),
        "subtotal": money(subtotal),
        "coupon_discount": money(coupon_discount),
        "loyalty_discount": money(loyalty_discount),
        "taxable": money(taxable),
        "cgst": money(cgst),
        "sgst": money(sgst),
        "shipping": money(shipping),
        "total": money(total),
        "loyalty_points_earned": calculate_loyalty_points(total),
        "item_finishing": item_finishing,
    }


def shipping_amount(subtotal: Decimal) -> Decimal:
    if subtotal >= Decimal(str(settings.FREE_SHIPPING_THRESHOLD)):
        return Decimal("0.00")
    return Decimal("99.00")


def finishing_line_fee(blouse_stitching: bool, fall_pico: bool, quantity: int = 1) -> Decimal:
    total = Decimal("0.00")
    if blouse_stitching:
        total += money(settings.BLOUSE_STITCH_FEE)
    if fall_pico:
        total += money(settings.FALL_PICO_FEE)
    return money(total * max(1, quantity))

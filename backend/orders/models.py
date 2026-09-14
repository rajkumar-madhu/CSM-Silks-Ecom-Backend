from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils import timezone

from accounts.models import Address
from catalog.models import Product, ProductVariant


class Coupon(models.Model):
    class DiscountType(models.TextChoices):
        FLAT = "flat", "Flat amount"
        PERCENT = "percent", "Percentage"

    code = models.CharField(max_length=30, unique=True, db_index=True)
    description = models.CharField(max_length=180, blank=True)
    discount_type = models.CharField(max_length=20, choices=DiscountType.choices)
    value = models.DecimalField(max_digits=12, decimal_places=2)
    min_order_value = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    usage_limit = models.PositiveIntegerField(null=True, blank=True)
    used_count = models.PositiveIntegerField(default=0)
    starts_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["code"]

    def __str__(self) -> str:
        return self.code


class OfferQuerySet(models.QuerySet):
    def live(self):
        """Active and inside its window. A row with no window is always in it."""
        now = timezone.now()
        return (
            self.filter(is_active=True)
            .filter(models.Q(starts_at__isnull=True) | models.Q(starts_at__lte=now))
            .filter(models.Q(expires_at__isnull=True) | models.Q(expires_at__gte=now))
        )


class Offer(models.Model):
    """A promotion the storefront advertises, as distinct from the discount itself.

    Coupon is the redeemable thing: a code, a value, the rules checkout enforces. An
    Offer is how a promotion is *presented* on the product page, and a coupon-kind
    Offer points at its Coupon rather than restating the code and terms, so the card
    can never advertise a code that checkout has expired or deactivated.

    COINS is the one kind that changes what a shopper is owed, so it is not display
    text: calculate_loyalty_points multiplies by the live multiplier, and the rate the
    product page quotes comes from the same helper. A coins offer nobody honours would
    be exactly the drift loyalty_points_per_rupee was added to prevent.
    """

    class Kind(models.TextChoices):
        COUPON = "coupon", "Coupon code"
        BANK = "bank", "Bank or card offer"
        COINS = "coins", "Loyalty coins"
        SHIPPING = "shipping", "Shipping"

    kind = models.CharField(max_length=20, choices=Kind.choices)
    title = models.CharField(max_length=120)
    note = models.CharField(max_length=180, blank=True)
    coupon = models.ForeignKey(
        Coupon, null=True, blank=True, on_delete=models.SET_NULL, related_name="offers"
    )
    # Only read for COINS. 2.00 means a shopper earns twice the usual coins.
    coins_multiplier = models.DecimalField(
        max_digits=4, decimal_places=2, null=True, blank=True
    )
    sort_order = models.PositiveIntegerField(default=0)
    starts_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = OfferQuerySet.as_manager()

    class Meta:
        ordering = ["sort_order", "id"]

    def __str__(self) -> str:
        return f"{self.get_kind_display()}: {self.title}"

    @property
    def code(self) -> str:
        """The coupon code a shopper types, or "" when this offer needs no code.

        Read through the Coupon so a deactivated or expired coupon stops being
        advertised even if someone leaves the offer row switched on.
        """
        if self.kind != self.Kind.COUPON or not self.coupon:
            return ""
        if not self.coupon.is_active:
            return ""
        now = timezone.now()
        if self.coupon.starts_at and self.coupon.starts_at > now:
            return ""
        if self.coupon.expires_at and self.coupon.expires_at < now:
            return ""
        return self.coupon.code


class Order(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PAYMENT_PENDING = "payment_pending", "Payment pending"
        CONFIRMED = "confirmed", "Confirmed"
        QUALITY_CHECK = "quality_check", "Quality check"
        PACKED = "packed", "Packed"
        SHIPPED = "shipped", "Shipped"
        OUT_FOR_DELIVERY = "out_for_delivery", "Out for delivery"
        DELIVERED = "delivered", "Delivered"
        DELIVERY_FAILED = "delivery_failed", "Delivery failed"
        RTO_INITIATED = "rto_initiated", "RTO initiated"
        RTO_DELIVERED = "rto_delivered", "RTO delivered"
        CANCELLED = "cancelled", "Cancelled"
        RETURN_INITIATED = "return_initiated", "Return initiated"
        RETURNED = "returned", "Returned"
        REFUNDED = "refunded", "Refunded"

    class PaymentMethod(models.TextChoices):
        RAZORPAY = "razorpay", "Razorpay"
        COD = "cod", "Cash on delivery"

    order_number = models.CharField(max_length=40, unique=True, db_index=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="orders", on_delete=models.PROTECT)
    address = models.ForeignKey(Address, null=True, blank=True, on_delete=models.SET_NULL)
    subtotal = models.DecimalField(max_digits=12, decimal_places=2)
    discount_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    coupon_code = models.CharField(max_length=30, blank=True)
    cgst_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    sgst_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    shipping_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_amount = models.DecimalField(max_digits=12, decimal_places=2)
    status = models.CharField(max_length=30, choices=Status.choices, default=Status.PENDING, db_index=True)
    payment_method = models.CharField(max_length=20, choices=PaymentMethod.choices, default=PaymentMethod.RAZORPAY)
    courier_name = models.CharField(max_length=80, blank=True)
    tracking_number = models.CharField(max_length=100, blank=True)
    courier_url = models.URLField(blank=True)
    estimated_delivery = models.DateTimeField(null=True, blank=True)
    shipping_address_snapshot = models.JSONField(default=dict, blank=True)
    loyalty_points_earned = models.PositiveIntegerField(default=0)
    loyalty_points_used = models.PositiveIntegerField(default=0)
    finishing_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    occasion_note = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    shipped_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    @property
    def gst_total(self):
        return self.cgst_amount + self.sgst_amount

    def __str__(self) -> str:
        return self.order_number


class OrderItem(models.Model):
    order = models.ForeignKey(Order, related_name="items", on_delete=models.CASCADE)
    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    variant = models.ForeignKey(ProductVariant, on_delete=models.PROTECT)
    product_name = models.CharField(max_length=255)
    product_sku = models.CharField(max_length=60)
    variant_title = models.CharField(max_length=120, blank=True)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)
    quantity = models.PositiveIntegerField(default=1)
    subtotal = models.DecimalField(max_digits=12, decimal_places=2)
    selected_colour = models.CharField(max_length=60, blank=True)
    blouse_stitching = models.BooleanField(default=False)
    blouse_size = models.CharField(max_length=12, blank=True)
    fall_pico = models.BooleanField(default=False)
    is_reviewed = models.BooleanField(default=False)


class ReturnRequest(models.Model):
    class Status(models.TextChoices):
        REQUESTED = "requested", "Requested"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        PICKED_UP = "picked_up", "Picked up"
        REFUNDED = "refunded", "Refunded"

    order = models.ForeignKey(Order, related_name="returns", on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="return_requests", on_delete=models.CASCADE)
    reason = models.CharField(max_length=120)
    details = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.REQUESTED)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

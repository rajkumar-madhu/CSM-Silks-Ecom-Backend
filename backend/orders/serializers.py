from __future__ import annotations

from rest_framework import serializers

from catalog.serializers import ProductListSerializer

from .models import Coupon, Offer, Order, OrderItem, ReturnRequest


class OfferSerializer(serializers.ModelSerializer):
    # Read-only, and resolved through the Coupon: see Offer.code for why an offer
    # whose coupon has lapsed advertises no code at all.
    code = serializers.CharField(read_only=True)

    class Meta:
        model = Offer
        fields = [
            "id",
            "kind",
            "title",
            "note",
            "code",
            "coupon",
            "coins_multiplier",
            "sort_order",
            "starts_at",
            "expires_at",
            "is_active",
        ]

    def validate(self, attrs):
        kind = attrs.get("kind", getattr(self.instance, "kind", None))
        coupon = attrs.get("coupon", getattr(self.instance, "coupon", None))
        multiplier = attrs.get("coins_multiplier", getattr(self.instance, "coins_multiplier", None))
        if kind == Offer.Kind.COUPON and not coupon:
            raise serializers.ValidationError({"coupon": "A coupon offer must point at a coupon."})
        if kind == Offer.Kind.COINS and not multiplier:
            raise serializers.ValidationError(
                {"coins_multiplier": "A coins offer must set the multiplier it pays."}
            )
        if multiplier is not None and multiplier <= 0:
            raise serializers.ValidationError({"coins_multiplier": "The multiplier must be positive."})
        return attrs


class CouponSerializer(serializers.ModelSerializer):
    class Meta:
        model = Coupon
        fields = [
            "id",
            "code",
            "description",
            "discount_type",
            "value",
            "min_order_value",
            "usage_limit",
            "used_count",
            "starts_at",
            "expires_at",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["used_count", "created_at", "updated_at"]

    def validate_code(self, value: str) -> str:
        return value.upper().strip()


class FinishingChoiceSerializer(serializers.Serializer):
    cart_item_id = serializers.IntegerField()
    blouse_stitching = serializers.BooleanField(required=False, default=False)
    blouse_size = serializers.CharField(required=False, allow_blank=True, max_length=12)
    fall_pico = serializers.BooleanField(required=False, default=False)


class OrderCreateSerializer(serializers.Serializer):
    address_id = serializers.IntegerField()
    coupon_code = serializers.CharField(required=False, allow_blank=True)
    loyalty_points_to_use = serializers.IntegerField(required=False, min_value=0, default=0)
    payment_method = serializers.ChoiceField(choices=Order.PaymentMethod.choices, default=Order.PaymentMethod.COD)
    occasion_note = serializers.CharField(required=False, allow_blank=True, max_length=200)
    finishing = FinishingChoiceSerializer(many=True, required=False)


class OrderItemSerializer(serializers.ModelSerializer):
    product = ProductListSerializer(read_only=True)
    variant_id = serializers.IntegerField(source="variant.id", read_only=True)

    class Meta:
        model = OrderItem
        fields = [
            "id",
            "product_id",
            "variant_id",
            "product",
            "product_name",
            "product_sku",
            "variant_title",
            "unit_price",
            "quantity",
            "subtotal",
            "selected_colour",
            "blouse_stitching",
            "blouse_size",
            "fall_pico",
            "is_reviewed",
        ]


class PublicOrderItemSerializer(serializers.ModelSerializer):
    product = ProductListSerializer(read_only=True)

    class Meta:
        model = OrderItem
        fields = ["id", "product", "product_name", "quantity"]


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    gst_total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    payment_status = serializers.SerializerMethodField()
    tracking_url = serializers.SerializerMethodField()
    tracking_events = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = [
            "id",
            "order_number",
            "status",
            "payment_method",
            "payment_status",
            "subtotal",
            "discount_amount",
            "coupon_code",
            "cgst_amount",
            "sgst_amount",
            "gst_total",
            "shipping_amount",
            "finishing_amount",
            "occasion_note",
            "total_amount",
            "courier_name",
            "tracking_number",
            "courier_url",
            "tracking_url",
            "tracking_events",
            "estimated_delivery",
            "shipping_address_snapshot",
            "loyalty_points_earned",
            "loyalty_points_used",
            "items",
            "created_at",
            "confirmed_at",
            "shipped_at",
            "delivered_at",
        ]

    def get_payment_status(self, obj: Order) -> str:
        payment = getattr(obj, "payment", None)
        return payment.status if payment else ""

    def get_tracking_url(self, obj: Order) -> str:
        return obj.courier_url

    def get_tracking_events(self, obj: Order) -> list[dict]:
        from shipping.serializers import ShipmentEventSerializer

        events = list(obj.tracking_events.all())
        if events:
            return ShipmentEventSerializer(events, many=True).data
        return []


class PublicOrderTrackingSerializer(OrderSerializer):
    items = PublicOrderItemSerializer(many=True, read_only=True)

    class Meta(OrderSerializer.Meta):
        fields = [
            "id",
            "order_number",
            "status",
            "payment_method",
            "payment_status",
            "total_amount",
            "courier_name",
            "tracking_number",
            "courier_url",
            "tracking_url",
            "tracking_events",
            "estimated_delivery",
            "items",
            "created_at",
            "confirmed_at",
            "shipped_at",
            "delivered_at",
        ]


class AdminOrderStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Order.Status.choices)
    tracking_number = serializers.CharField(required=False, allow_blank=True)
    courier_name = serializers.CharField(required=False, allow_blank=True)
    courier_url = serializers.URLField(required=False, allow_blank=True)


class AdminOrderWorkflowSerializer(serializers.Serializer):
    action = serializers.ChoiceField(
        choices=[
            "confirm",
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
            "cancel",
        ]
    )
    provider = serializers.CharField(required=False, allow_blank=True, default="manual")
    note = serializers.CharField(required=False, allow_blank=True, default="")
    location = serializers.CharField(required=False, allow_blank=True, default="")


class ReturnCreateSerializer(serializers.Serializer):
    order_id = serializers.IntegerField()
    reason = serializers.CharField(max_length=120)
    details = serializers.CharField(required=False, allow_blank=True)


class AdminReturnStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=ReturnRequest.Status.choices)


class ReturnSerializer(serializers.ModelSerializer):
    order_number = serializers.CharField(source="order.order_number", read_only=True)
    customer = serializers.CharField(source="user.display_name", read_only=True)

    class Meta:
        model = ReturnRequest
        fields = ["id", "order", "order_number", "customer", "reason", "details", "status", "created_at", "updated_at"]

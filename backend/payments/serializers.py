from decimal import Decimal

from rest_framework import serializers


class RazorpayOrderCreateSerializer(serializers.Serializer):
    order_id = serializers.IntegerField()


class RazorpayVerifySerializer(serializers.Serializer):
    razorpay_order_id = serializers.CharField()
    razorpay_payment_id = serializers.CharField()
    razorpay_signature = serializers.CharField()


class RefundSerializer(serializers.Serializer):
    order_id = serializers.IntegerField()
    # min_value keeps zero/negative amounts out before they reach the gateway.
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, min_value=Decimal("0.01"))

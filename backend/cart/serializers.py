from __future__ import annotations

from rest_framework import serializers

from catalog.models import Product, ProductVariant
from catalog.serializers import ProductListSerializer
from orders.pricing import calculate_coupon_discount, calculate_gst, shipping_amount

from .models import Cart, CartItem, WishlistItem


class CartItemWriteSerializer(serializers.Serializer):
    product_id = serializers.IntegerField(required=False)
    variant_id = serializers.IntegerField()
    quantity = serializers.IntegerField(min_value=1, max_value=10, default=1)


class CartItemQuantitySerializer(serializers.Serializer):
    quantity = serializers.IntegerField(min_value=1, max_value=10)


class CartItemSerializer(serializers.ModelSerializer):
    product = ProductListSerializer(read_only=True)
    variant_id = serializers.IntegerField(source="variant.id", read_only=True)
    variant_sku = serializers.CharField(source="variant.sku", read_only=True)
    variant_available_qty = serializers.IntegerField(source="variant.available_qty", read_only=True)
    variant_stock_qty = serializers.IntegerField(source="variant.stock_qty", read_only=True)
    variant_reserved_qty = serializers.IntegerField(source="variant.reserved_qty", read_only=True)
    stock_status = serializers.SerializerMethodField()
    stock_message = serializers.SerializerMethodField()
    line_total = serializers.SerializerMethodField()
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_price = serializers.DecimalField(source="variant.price", max_digits=12, decimal_places=2, read_only=True)
    product_image = serializers.SerializerMethodField()

    class Meta:
        model = CartItem
        fields = [
            "id",
            "product_id",
            "variant_id",
            "variant_sku",
            "quantity",
            "variant_available_qty",
            "variant_stock_qty",
            "variant_reserved_qty",
            "stock_status",
            "stock_message",
            "product",
            "product_name",
            "product_price",
            "product_image",
            "line_total",
            "created_at",
            "updated_at",
        ]

    def get_line_total(self, obj: CartItem):
        return obj.variant.price * obj.quantity

    def get_stock_status(self, obj: CartItem) -> str:
        if not obj.variant.is_active:
            return "inactive"
        if obj.variant.available_qty <= 0:
            return "out_of_stock"
        if obj.variant.available_qty < obj.quantity:
            return "insufficient"
        return "ok"

    def get_stock_message(self, obj: CartItem) -> str:
        status = self.get_stock_status(obj)
        if status == "inactive":
            return "This SKU is no longer available"
        if status == "out_of_stock":
            return "This SKU is currently sold out"
        if status == "insufficient":
            return f"Only {obj.variant.available_qty} units available for this SKU"
        return f"{obj.variant.available_qty} units available"

    def get_product_image(self, obj: CartItem) -> str:
        image = obj.product.images.filter(is_primary=True).first() or obj.product.images.first()
        return image.image_url if image else ""


def cart_totals(cart: Cart) -> dict:
    items = list(cart.items.select_related("product", "variant").prefetch_related("product__variants", "product__images", "product__category"))
    subtotal = sum(item.variant.price * item.quantity for item in items)
    discount = calculate_coupon_discount(subtotal, cart.coupon_code)
    taxable = subtotal - discount
    cgst, sgst = calculate_gst(taxable)
    shipping = shipping_amount(taxable)
    total = taxable + cgst + sgst + shipping
    return {
        "items": items,
        "item_count": sum(item.quantity for item in items),
        "subtotal": subtotal,
        "discount": discount,
        "coupon_code": cart.coupon_code,
        "cgst": cgst,
        "sgst": sgst,
        "shipping": shipping,
        "total": total,
        "free_shipping": shipping == 0,
    }


class CartSerializer(serializers.ModelSerializer):
    items = serializers.SerializerMethodField()
    item_count = serializers.SerializerMethodField()
    has_stock_issues = serializers.SerializerMethodField()
    stock_issues = serializers.SerializerMethodField()
    subtotal = serializers.SerializerMethodField()
    discount = serializers.SerializerMethodField()
    cgst = serializers.SerializerMethodField()
    sgst = serializers.SerializerMethodField()
    shipping = serializers.SerializerMethodField()
    total = serializers.SerializerMethodField()
    free_shipping = serializers.SerializerMethodField()

    class Meta:
        model = Cart
        fields = [
            "id",
            "items",
            "item_count",
            "has_stock_issues",
            "stock_issues",
            "subtotal",
            "discount",
            "coupon_code",
            "cgst",
            "sgst",
            "shipping",
            "total",
            "free_shipping",
        ]

    def _totals(self, obj: Cart) -> dict:
        if not hasattr(obj, "_summary"):
            obj._summary = cart_totals(obj)
        return obj._summary

    def get_items(self, obj: Cart):
        return CartItemSerializer(self._totals(obj)["items"], many=True).data

    def get_item_count(self, obj: Cart):
        return self._totals(obj)["item_count"]

    def get_stock_issues(self, obj: Cart):
        issues = []
        for item in self._totals(obj)["items"]:
            if not item.variant.is_active:
                issues.append(
                    {
                        "item_id": item.id,
                        "variant_id": item.variant_id,
                        "sku": item.variant.sku,
                        "requested_qty": item.quantity,
                        "available_qty": item.variant.available_qty,
                        "status": "inactive",
                        "message": f"{item.product.name} is no longer available",
                    }
                )
            elif item.variant.available_qty < item.quantity:
                issues.append(
                    {
                        "item_id": item.id,
                        "variant_id": item.variant_id,
                        "sku": item.variant.sku,
                        "requested_qty": item.quantity,
                        "available_qty": item.variant.available_qty,
                        "status": "insufficient" if item.variant.available_qty > 0 else "out_of_stock",
                        "message": f"{item.product.name}: only {item.variant.available_qty} units available",
                    }
                )
        return issues

    def get_has_stock_issues(self, obj: Cart):
        return bool(self.get_stock_issues(obj))

    def get_subtotal(self, obj: Cart):
        return self._totals(obj)["subtotal"]

    def get_discount(self, obj: Cart):
        return self._totals(obj)["discount"]

    def get_cgst(self, obj: Cart):
        return self._totals(obj)["cgst"]

    def get_sgst(self, obj: Cart):
        return self._totals(obj)["sgst"]

    def get_shipping(self, obj: Cart):
        return self._totals(obj)["shipping"]

    def get_total(self, obj: Cart):
        return self._totals(obj)["total"]

    def get_free_shipping(self, obj: Cart):
        return self._totals(obj)["free_shipping"]


class WishlistItemSerializer(serializers.ModelSerializer):
    product = ProductListSerializer(read_only=True)

    class Meta:
        model = WishlistItem
        fields = ["id", "product", "created_at"]


class WishlistWriteSerializer(serializers.Serializer):
    product_id = serializers.IntegerField()


class CartQuoteFinishingSerializer(serializers.Serializer):
    cart_item_id = serializers.IntegerField()
    blouse_stitching = serializers.BooleanField(required=False, default=False)
    blouse_size = serializers.CharField(required=False, allow_blank=True, default="")
    fall_pico = serializers.BooleanField(required=False, default=False)


class CartQuoteSerializer(serializers.Serializer):
    finishing = CartQuoteFinishingSerializer(many=True, required=False)
    coupon_code = serializers.CharField(required=False, allow_blank=True)
    loyalty_points_to_use = serializers.IntegerField(required=False, min_value=0)

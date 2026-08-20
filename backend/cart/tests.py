from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Address
from catalog.models import Category, Product, ProductVariant
from orders.models import Coupon, Order
from orders.services import create_order_from_cart

from .models import Cart, CartItem

User = get_user_model()

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from catalog.models import Category, Product, ProductVariant

User = get_user_model()


class CartStockTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="+919811112222",
            phone="+919811112222",
            password="customer123",
            is_verified=True,
            role="customer",
        )
        category = Category.objects.create(name="Kanjivaram", slug="kanjivaram", gender="women")
        self.product = Product.objects.create(
            name="Cart Stock Saree",
            slug="cart-stock-saree",
            category=category,
            gender="women",
            base_price=2500,
            base_mrp=3000,
            is_active=True,
        )
        self.variant = ProductVariant.objects.create(
            product=self.product,
            sku="CART-STOCK-1",
            price=2500,
            mrp=3000,
            stock_qty=2,
            reserved_qty=0,
            is_active=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_existing_cart_line_cannot_exceed_available_stock(self):
        first = self.client.post("/api/cart", {"variant_id": self.variant.id, "quantity": 1}, format="json")
        self.assertEqual(first.status_code, 200)

        second = self.client.post("/api/cart", {"variant_id": self.variant.id, "quantity": 2}, format="json")

        self.assertEqual(second.status_code, 400)
        self.assertEqual(second.json()["detail"], "Only 2 units available")
        cart = self.client.get("/api/cart").json()
        self.assertEqual(cart["items"][0]["quantity"], 1)

    def test_cart_response_reports_live_stock_issues(self):
        self.client.post("/api/cart", {"variant_id": self.variant.id, "quantity": 2}, format="json")
        self.variant.stock_qty = 1
        self.variant.save(update_fields=["stock_qty", "updated_at"])

        response = self.client.get("/api/cart")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["has_stock_issues"])
        self.assertEqual(body["stock_issues"][0]["variant_id"], self.variant.id)
        self.assertEqual(body["stock_issues"][0]["available_qty"], 1)
        self.assertEqual(body["items"][0]["stock_status"], "insufficient")
        self.assertEqual(body["items"][0]["variant_available_qty"], 1)


class CartQuoteMatchesOrderTests(TestCase):
    """The quote endpoint and create_order_from_cart must agree exactly — this is the
    percent-coupon + finishing-fee case where the SPA's own arithmetic drifted."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="quote-1", email="quote1@example.com", password="pw123456", phone="+919900000701"
        )
        self.address = Address.objects.create(
            user=self.user, full_name="Quote Tester", phone="+919900000701",
            address_line_1="1 Silk Street", city="Kanchipuram", state="TN", pin_code="631502",
        )
        category = Category.objects.create(name="Sarees", slug="sarees-quote")
        product = Product.objects.create(
            name="Quote Saree", slug="quote-saree", category=category, is_active=True, gender="women"
        )
        self.variant = ProductVariant.objects.create(
            product=product, sku="QUOTE-1", price=Decimal("10000.00"), mrp=Decimal("12000.00"), stock_qty=10
        )
        Coupon.objects.create(
            code="CSM10", is_active=True, discount_type=Coupon.DiscountType.PERCENT, value=Decimal("10")
        )
        cart, _ = Cart.objects.get_or_create(user=self.user)
        self.item = CartItem.objects.create(cart=cart, product=product, variant=self.variant, quantity=1)

        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_quote_equals_the_amount_actually_charged(self):
        finishing = [{"cart_item_id": self.item.id, "blouse_stitching": True, "blouse_size": "36", "fall_pico": False}]

        resp = self.client.post(
            "/api/cart/quote", {"finishing": finishing, "coupon_code": "CSM10"}, format="json"
        )
        self.assertEqual(resp.status_code, 200)
        quoted = Decimal(resp.json()["total"])

        order = create_order_from_cart(
            self.user, self.address.id, coupon_code="CSM10",
            payment_method=Order.PaymentMethod.COD, finishing=finishing,
        )
        self.assertEqual(quoted, order.total_amount)

    def test_quote_prices_finishing_into_the_coupon_base(self):
        finishing = [{"cart_item_id": self.item.id, "blouse_stitching": True, "blouse_size": "36", "fall_pico": False}]
        resp = self.client.post(
            "/api/cart/quote", {"finishing": finishing, "coupon_code": "CSM10"}, format="json"
        )
        body = resp.json()
        # 10000 goods + 350 stitching = 10350; a 10% coupon discounts the full 10350.
        self.assertEqual(Decimal(body["goods_subtotal"]), Decimal("10000.00"))
        self.assertEqual(Decimal(body["finishing_total"]), Decimal("350.00"))
        self.assertEqual(Decimal(body["subtotal"]), Decimal("10350.00"))
        self.assertEqual(Decimal(body["coupon_discount"]), Decimal("1035.00"))

    def test_stitching_without_a_size_is_a_400_not_a_500(self):
        resp = self.client.post(
            "/api/cart/quote",
            {"finishing": [{"cart_item_id": self.item.id, "blouse_stitching": True, "blouse_size": ""}]},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)

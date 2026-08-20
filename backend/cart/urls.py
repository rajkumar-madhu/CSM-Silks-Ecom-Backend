from django.urls import path

from .views import CartItemView, CartQuoteView, CartView, CouponView, WishlistDetailView, WishlistView

urlpatterns = [
    path("cart", CartView.as_view()),
    path("cart/items/<int:item_id>", CartItemView.as_view()),
    path("cart/coupon", CouponView.as_view()),
    path("cart/quote", CartQuoteView.as_view()),
    path("checkout/summary", CartView.as_view()),
    path("wishlist", WishlistView.as_view()),
    path("wishlist/<slug:product_slug>", WishlistDetailView.as_view()),
]

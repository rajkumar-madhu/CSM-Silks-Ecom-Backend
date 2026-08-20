from __future__ import annotations

from decimal import Decimal

from django.db import models
from django.utils import timezone


class Category(models.Model):
    class Gender(models.TextChoices):
        WOMEN = "women", "Women"
        MEN = "men", "Men"
        UNISEX = "unisex", "Unisex"

    name = models.CharField(max_length=120)
    slug = models.SlugField(unique=True)
    gender = models.CharField(max_length=10, choices=Gender.choices, default=Gender.WOMEN)
    parent = models.ForeignKey("self", null=True, blank=True, related_name="children", on_delete=models.SET_NULL)
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order", "name"]
        verbose_name_plural = "categories"

    def __str__(self) -> str:
        return self.name


class Collection(models.Model):
    name = models.CharField(max_length=120)
    slug = models.SlugField(unique=True)
    description = models.TextField(blank=True)
    is_featured = models.BooleanField(default=False)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "name"]

    def __str__(self) -> str:
        return self.name


class Product(models.Model):
    class Gender(models.TextChoices):
        WOMEN = "women", "Women"
        MEN = "men", "Men"
        UNISEX = "unisex", "Unisex"

    name = models.CharField(max_length=255)
    name_tamil = models.CharField(max_length=255, blank=True)
    slug = models.SlugField(unique=True)
    description = models.TextField(blank=True)
    hook = models.CharField(max_length=255, blank=True)
    category = models.ForeignKey(Category, related_name="products", on_delete=models.PROTECT)
    collections = models.ManyToManyField(Collection, related_name="products", blank=True)
    gender = models.CharField(max_length=10, choices=Gender.choices, default=Gender.WOMEN)
    tags = models.JSONField(default=list, blank=True)
    occasions = models.JSONField(default=list, blank=True)
    brand = models.CharField(max_length=120, default="CSM Silks")
    seller_name = models.CharField(max_length=140, default="CSM Silks Kanchipuram")
    hsn_code = models.CharField(max_length=10, default="5007")
    base_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    base_mrp = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    meta_title = models.CharField(max_length=255, blank=True)
    meta_description = models.TextField(blank=True)
    deal_label = models.CharField(max_length=120, blank=True)
    key_highlights = models.JSONField(default=list, blank=True)
    specifications = models.JSONField(default=dict, blank=True)
    serviceable_pin_codes = models.JSONField(default=list, blank=True)
    delivery_min_days = models.PositiveSmallIntegerField(default=2)
    delivery_max_days = models.PositiveSmallIntegerField(default=6)
    return_days = models.PositiveSmallIntegerField(default=15)
    cod_available = models.BooleanField(default=True)
    exchange_available = models.BooleanField(default=True)
    assured = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True, db_index=True)
    is_featured = models.BooleanField(default=False)
    is_gi_tagged = models.BooleanField(default=True)
    avg_rating = models.DecimalField(max_digits=3, decimal_places=2, default=Decimal("0.00"))
    review_count = models.PositiveIntegerField(default=0)
    total_sold = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-is_featured", "-created_at"]
        indexes = [
            models.Index(fields=["gender", "is_active"]),
            models.Index(fields=["is_featured", "is_active"]),
        ]

    def __str__(self) -> str:
        return self.name

    @property
    def default_variant(self):
        active = [variant for variant in self.variants.all() if variant.is_active]
        return active[0] if active else None

    @property
    def price(self) -> Decimal:
        variant = self.default_variant
        return variant.price if variant else self.base_price

    @property
    def mrp(self) -> Decimal:
        variant = self.default_variant
        return variant.mrp if variant else self.base_mrp

    @property
    def discount_percent(self) -> int:
        mrp = self.mrp
        if mrp > 0:
            return round((1 - (self.price / mrp)) * 100)
        return 0


class ProductVariant(models.Model):
    product = models.ForeignKey(Product, related_name="variants", on_delete=models.CASCADE)
    sku = models.CharField(max_length=60, unique=True)
    title = models.CharField(max_length=120, blank=True)
    color_name = models.CharField(max_length=60, blank=True)
    color_hex = models.CharField(max_length=16, blank=True)
    size = models.CharField(max_length=40, blank=True)
    fabric = models.CharField(max_length=100, blank=True)
    zari_type = models.CharField(max_length=80, blank=True)
    blouse_included = models.BooleanField(default=True)
    length_meters = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    care_instructions = models.TextField(blank=True)
    price = models.DecimalField(max_digits=12, decimal_places=2)
    mrp = models.DecimalField(max_digits=12, decimal_places=2)
    cost_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    stock_qty = models.PositiveIntegerField(default=0)
    reserved_qty = models.PositiveIntegerField(default=0)
    reorder_level = models.PositiveIntegerField(default=5)
    last_sold_at = models.DateTimeField(null=True, blank=True, db_index=True)
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["product__name", "sku"]
        indexes = [
            models.Index(fields=["sku"]),
            models.Index(fields=["is_active", "stock_qty"]),
        ]

    @property
    def available_qty(self) -> int:
        return max(0, self.stock_qty - self.reserved_qty)

    def mark_sold(self, quantity: int) -> None:
        self.stock_qty = max(0, self.stock_qty - quantity)
        self.last_sold_at = timezone.now()
        self.save(update_fields=["stock_qty", "last_sold_at", "updated_at"])

    def __str__(self) -> str:
        return f"{self.sku} - {self.product.name}"


class ProductImage(models.Model):
    product = models.ForeignKey(Product, related_name="images", on_delete=models.CASCADE)
    variant = models.ForeignKey(ProductVariant, related_name="images", null=True, blank=True, on_delete=models.CASCADE)
    image_url = models.URLField(max_length=600, blank=True)
    alt_text = models.CharField(max_length=160, blank=True)
    sort_order = models.PositiveIntegerField(default=0)
    is_primary = models.BooleanField(default=False)

    class Meta:
        ordering = ["sort_order", "id"]

    def __str__(self) -> str:
        return self.alt_text or self.product.name


class StockAlert(models.Model):
    variant = models.ForeignKey(ProductVariant, related_name="stock_alerts", on_delete=models.CASCADE)
    phone = models.CharField(max_length=15, db_index=True)
    email = models.EmailField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    notified_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["variant", "phone"], name="uniq_stock_alert_variant_phone"),
        ]

    def __str__(self) -> str:
        return f"{self.phone} → {self.variant.sku}"

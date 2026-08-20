from __future__ import annotations

from collections import Counter
from datetime import timedelta
from math import ceil

from django.core.files.storage import default_storage
from django.core.files.uploadedfile import UploadedFile
from django.db.models import Count, Max, Min
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from accounts.permissions import IsStaffAdmin
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import AttributeOption, Category, Collection, Product, ProductImage, ProductVariant, StockAlert
from .realtime import (
    publish_category_update,
    publish_collection_update,
    publish_image_update,
    publish_product_deleted,
    publish_product_update,
)
from .selectors import ATTRIBUTE_PARAMS, product_base_queryset, public_products
from .serializers import (
    AdminAttributeOptionSerializer,
    AdminCategoryWriteSerializer,
    AdminCollectionWriteSerializer,
    AdminProductImageWriteSerializer,
    AdminProductQuickCreateSerializer,
    AdminProductWriteSerializer,
    AdminVariantWriteSerializer,
    CategorySerializer,
    CollectionSerializer,
    ProductDetailSerializer,
    ProductImageSerializer,
    ProductListSerializer,
    ProductVariantSerializer,
)


class ProductListView(APIView):
    def get(self, request):
        page = max(int(request.query_params.get("page", 1)), 1)
        per_page = min(max(int(request.query_params.get("per_page", 12)), 1), 48)
        qs = public_products(request.query_params)
        total = qs.count()
        items = qs[(page - 1) * per_page : page * per_page]
        return Response(
            {
                "items": ProductListSerializer(items, many=True).data,
                "total": total,
                "page": page,
                "per_page": per_page,
                "pages": ceil(total / per_page) if total else 0,
            }
        )


class ProductDetailView(APIView):
    def get(self, request, slug: str):
        product = get_object_or_404(product_base_queryset().filter(is_active=True), slug=slug)
        return Response(ProductDetailSerializer(product).data)


class CategoryListView(APIView):
    def get(self, request):
        categories = Category.objects.filter(is_active=True).order_by("sort_order", "name")
        return Response(CategorySerializer(categories, many=True).data)


class CollectionListView(APIView):
    def get(self, request):
        collections = Collection.objects.order_by("sort_order", "name")
        return Response(CollectionSerializer(collections, many=True).data)


def _attribute_groups(params) -> list[dict]:
    """Attribute-facet groups, scoped to saree-category products by construction.

    Deliberately NOT gated on gender or a `category` param guess: `Category.product_type`
    is the source of truth for "is this a saree" (see the comment on that field), so a
    gender=women listing of, say, kurtis correctly yields zero saree-category products
    here and therefore no groups — no separate scope check needed.
    """
    labels = dict(AttributeOption.Key.choices)
    groups = []
    for key in ATTRIBUTE_PARAMS:
        # Count over the queryset with THIS group's own filter removed, so ticking
        # one option does not zero out its siblings. Other filters still apply.
        trimmed = params.copy()
        trimmed.pop(key, None)
        rows = (
            public_products(trimmed)
            .filter(category__product_type=Category.ProductType.SAREE)
            .filter(**{f"{key}__is_filterable": True, f"{key}__is_active": True})
            .order_by()
            .values(f"{key}__value_slug", f"{key}__label", f"{key}__sort_order")
            .annotate(count=Count("id", distinct=True))
        )
        options = sorted(
            (
                {
                    "slug": row[f"{key}__value_slug"],
                    "label": row[f"{key}__label"],
                    "count": row["count"],
                    "_sort": row[f"{key}__sort_order"],
                }
                for row in rows
                if row["count"]
            ),
            key=lambda option: (option["_sort"], option["label"]),
        )
        for option in options:
            option.pop("_sort")
        # A single-option group is a checkbox that filters nothing. Hide it.
        if len(options) < 2:
            continue
        groups.append({"key": key, "label": labels[key], "options": options})
    return groups


class CatalogFacetsView(APIView):
    def get(self, request):
        products = public_products(request.query_params)
        variants = ProductVariant.objects.filter(product__in=products, is_active=True)
        price_bounds = variants.aggregate(min_price=Min("price"), max_price=Max("price"))
        colors = (
            variants.exclude(color_name="")
            .values("color_name", "color_hex")
            .annotate(count=Count("product_id", distinct=True))
            .order_by("color_name")
        )
        fabric_counts = (
            products.exclude(fabric__isnull=True)
            .order_by()
            .values("fabric__label")
            .annotate(count=Count("id", distinct=True))
            .order_by("fabric__label")
        )
        occasion_counter = Counter(
            occasion for product in products for occasion in (product.occasions or [])
        )
        category_counts = {
            row["category__slug"]: row["count"]
            for row in products.order_by().values("category__slug").annotate(count=Count("id", distinct=True))
            if row["category__slug"]
        }
        return Response(
            {
                "categories": CategorySerializer(Category.objects.filter(is_active=True), many=True).data,
                "colors": list(colors),
                "fabrics": [row["fabric__label"] for row in fabric_counts],
                "occasions": sorted(occasion_counter),
                "price": price_bounds,
                "total": products.distinct().count(),
                "category_counts": category_counts,
                "fabric_counts": [{"name": row["fabric__label"], "count": row["count"]} for row in fabric_counts],
                "occasion_counts": [
                    {"name": name, "count": occasion_counter[name]} for name in sorted(occasion_counter)
                ],
                "attributes": _attribute_groups(request.query_params),
                "sorts": [
                    {"key": "popularity", "label": "Popularity"},
                    {"key": "price_asc", "label": "Price: Low to High"},
                    {"key": "price_desc", "label": "Price: High to Low"},
                    {"key": "discount", "label": "Biggest Discount"},
                    {"key": "rating", "label": "Customer Rating"},
                    {"key": "newest", "label": "Newest First"},
                ],
            }
        )


class ProductDeliveryCheckView(APIView):
    def get(self, request, slug: str):
        product = get_object_or_404(product_base_queryset().filter(is_active=True), slug=slug)
        pin_code = (request.query_params.get("pin_code") or "").strip()
        configured_pins = product.serviceable_pin_codes or []
        is_serviceable = bool(pin_code) and (not configured_pins or pin_code in configured_pins)
        today = timezone.localdate()
        min_date = today + timedelta(days=product.delivery_min_days)
        max_date = today + timedelta(days=product.delivery_max_days)
        return Response(
            {
                "pin_code": pin_code,
                "serviceable": is_serviceable,
                "message": "Delivery available" if is_serviceable else "Enter a valid serviceable Indian PIN code",
                "eta_min": min_date,
                "eta_max": max_date,
                "cod_available": is_serviceable and product.cod_available,
                "exchange_available": product.exchange_available,
                "return_days": product.return_days,
                "seller_name": product.seller_name,
                "assured": product.assured,
            }
        )


class StockAlertView(APIView):
    throttle_scope = "otp"

    def post(self, request, slug: str):
        product = get_object_or_404(product_base_queryset().filter(is_active=True), slug=slug)
        phone = "".join(ch for ch in str(request.data.get("phone") or "") if ch.isdigit() or ch == "+")
        if phone and not phone.startswith("+") and len(phone) == 10:
            phone = f"+91{phone}"
        email = str(request.data.get("email") or "").strip()
        raw_variant_id = request.data.get("variant_id")
        variant = product.default_variant
        if raw_variant_id not in (None, ""):
            # filter(id=<non-numeric>) raises ValueError, which escapes this public endpoint
            # as a 500 because no DRF EXCEPTION_HANDLER is configured.
            try:
                variant_id = int(raw_variant_id)
            except (TypeError, ValueError):
                return Response({"detail": "Choose a size or colour to watch."}, status=status.HTTP_400_BAD_REQUEST)
            variant = product.variants.filter(id=variant_id).first()
        if not variant:
            return Response({"detail": "Choose a size or colour to watch."}, status=status.HTTP_400_BAD_REQUEST)
        if variant.available_qty > 0:
            return Response({"detail": "This weave is in stock — add it to cart."}, status=status.HTTP_400_BAD_REQUEST)
        # StockAlert.phone is max_length=15, so an over-long value would be a 500 on Postgres
        # (SQLite silently truncates, which is why dev and CI never saw it).
        digits = phone.replace("+", "")
        if len(digits) < 10 or len(phone) > 15:
            return Response({"detail": "Enter a valid mobile number."}, status=status.HTTP_400_BAD_REQUEST)
        alert, created = StockAlert.objects.update_or_create(
            variant=variant,
            phone=phone,
            defaults={"email": email, "notified_at": None},
        )
        return Response(
            {
                "ok": True,
                "created": created,
                "message": "We will WhatsApp/SMS you when this weave is back.",
                "sku": variant.sku,
            },
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class AdminProductListCreateView(APIView):
    permission_classes = [IsStaffAdmin]

    def get(self, request):
        page = max(int(request.query_params.get("page", 1)), 1)
        per_page = min(max(int(request.query_params.get("per_page", 20)), 1), 100)
        qs = product_base_queryset().all()
        total = qs.count()
        products = qs[(page - 1) * per_page : page * per_page]
        return Response(
            {
                "items": ProductListSerializer(products, many=True).data,
                "total": total,
                "page": page,
                "per_page": per_page,
                "pages": ceil(total / per_page) if total else 0,
            }
        )

    def post(self, request):
        serializer = AdminProductWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        product = serializer.save()
        publish_product_update(product, event_type="catalog.product.created", source="admin.product.create")
        return Response(ProductDetailSerializer(product_base_queryset().get(id=product.id)).data, status=status.HTTP_201_CREATED)


class AdminProductQuickCreateView(APIView):
    permission_classes = [IsStaffAdmin]

    def post(self, request):
        serializer = AdminProductQuickCreateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        product = serializer.save()
        publish_product_update(product, event_type="catalog.product.created", source="admin.product.quick_create")
        return Response(ProductDetailSerializer(product_base_queryset().get(id=product.id)).data, status=status.HTTP_201_CREATED)


class AdminProductDetailView(APIView):
    permission_classes = [IsStaffAdmin]

    def get(self, request, product_id: int):
        product = get_object_or_404(product_base_queryset(), id=product_id)
        return Response(ProductDetailSerializer(product).data)

    def patch(self, request, product_id: int):
        product = get_object_or_404(Product, id=product_id)
        serializer = AdminProductWriteSerializer(product, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        product = serializer.save()
        publish_product_update(product, event_type="catalog.product.updated", source="admin.product.patch")
        return Response(ProductDetailSerializer(product_base_queryset().get(id=product.id)).data)

    def delete(self, request, product_id: int):
        product = get_object_or_404(Product, id=product_id)
        product.is_active = False
        product.save(update_fields=["is_active", "updated_at"])
        publish_product_deleted(product, source="admin.product.delete")
        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminVariantListCreateView(APIView):
    permission_classes = [IsStaffAdmin]

    def get(self, request):
        # product__fabric / product__zari feed ProductVariantSerializer's fabric and
        # zari_type method fields; without them this unpaginated list is 2 queries per variant.
        variants = ProductVariant.objects.select_related(
            "product", "product__fabric", "product__zari"
        ).order_by("product__name", "sku")
        return Response(ProductVariantSerializer(variants, many=True).data)

    def post(self, request):
        serializer = AdminVariantWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        variant = serializer.save()
        publish_product_update(variant.product, event_type="catalog.variant.created", variant=variant, source="admin.variant.create")
        return Response(ProductVariantSerializer(variant).data, status=status.HTTP_201_CREATED)


class AdminVariantDetailView(APIView):
    permission_classes = [IsStaffAdmin]

    def patch(self, request, variant_id: int):
        variant = get_object_or_404(ProductVariant, id=variant_id)
        serializer = AdminVariantWriteSerializer(variant, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        variant = serializer.save()
        publish_product_update(variant.product, event_type="catalog.variant.updated", variant=variant, source="admin.variant.patch")
        return Response(ProductVariantSerializer(variant).data)


class AdminCategoryListCreateView(APIView):
    permission_classes = [IsStaffAdmin]

    def get(self, request):
        categories = Category.objects.order_by("sort_order", "name")
        return Response(CategorySerializer(categories, many=True).data)

    def post(self, request):
        serializer = AdminCategoryWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        category = serializer.save()
        publish_category_update(category, event_type="catalog.category.created")
        return Response(CategorySerializer(category).data, status=status.HTTP_201_CREATED)


class AdminCollectionListCreateView(APIView):
    permission_classes = [IsStaffAdmin]

    def get(self, request):
        collections = Collection.objects.order_by("sort_order", "name")
        return Response(CollectionSerializer(collections, many=True).data)

    def post(self, request):
        serializer = AdminCollectionWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        collection = serializer.save()
        publish_collection_update(collection, event_type="catalog.collection.created")
        return Response(CollectionSerializer(collection).data, status=status.HTTP_201_CREATED)


class AdminProductImageListCreateView(APIView):
    permission_classes = [IsStaffAdmin]

    def get(self, request):
        images = ProductImage.objects.select_related("product", "variant").order_by("-id")[:200]
        return Response(ProductImageSerializer(images, many=True).data)

    def post(self, request):
        uploaded_file: UploadedFile | None = request.FILES.get("image")
        if uploaded_file:
            if uploaded_file.size > 5 * 1024 * 1024:
                return Response({"detail": "Image must be 5MB or smaller"}, status=status.HTTP_400_BAD_REQUEST)
            if uploaded_file.content_type and not uploaded_file.content_type.startswith("image/"):
                return Response({"detail": "Only image uploads are allowed"}, status=status.HTTP_400_BAD_REQUEST)
            path = default_storage.save(f"product-images/{timezone.now():%Y%m%d%H%M%S}-{uploaded_file.name}", uploaded_file)
            file_url = default_storage.url(path)
            if not file_url.startswith(("http://", "https://", "/")):
                file_url = f"/{file_url}"
            image_url = request.build_absolute_uri(file_url)
            product_id = request.data.get("product")
            variant_id = request.data.get("variant") or None
            if product_id:
                image = ProductImage.objects.create(
                    product_id=product_id,
                    variant_id=variant_id,
                    image_url=image_url,
                    alt_text=request.data.get("alt_text", ""),
                    sort_order=int(request.data.get("sort_order") or 0),
                    is_primary=str(request.data.get("is_primary", "true")).lower() in {"1", "true", "yes"},
                )
                publish_image_update(image)
                return Response(ProductImageSerializer(image).data, status=status.HTTP_201_CREATED)
            return Response({"image_url": image_url}, status=status.HTTP_201_CREATED)
        serializer = AdminProductImageWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        image = serializer.save()
        publish_image_update(image)
        return Response(ProductImageSerializer(image).data, status=status.HTTP_201_CREATED)


class AdminAttributeOptionListCreateView(APIView):
    permission_classes = [IsStaffAdmin]

    def get(self, request):
        options = AttributeOption.objects.all()
        key = request.query_params.get("key")
        if key:
            options = options.filter(key=key)
        return Response(AdminAttributeOptionSerializer(options, many=True).data)

    def post(self, request):
        serializer = AdminAttributeOptionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        option = serializer.save()
        return Response(AdminAttributeOptionSerializer(option).data, status=status.HTTP_201_CREATED)


class AdminAttributeOptionDetailView(APIView):
    permission_classes = [IsStaffAdmin]

    def patch(self, request, option_id: int):
        option = get_object_or_404(AttributeOption, id=option_id)
        serializer = AdminAttributeOptionSerializer(option, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        option = serializer.save()
        return Response(AdminAttributeOptionSerializer(option).data)

    def delete(self, request, option_id: int):
        # Soft delete only: Product's seven attribute FKs are on_delete=PROTECT, so a hard
        # delete of an option still in use raises ProtectedError (unhandled 500). Retiring it
        # instead drops it from facets/admin choices while products keep pointing at it.
        option = get_object_or_404(AttributeOption, id=option_id)
        option.is_active = False
        option.save(update_fields=["is_active"])
        return Response(status=status.HTTP_204_NO_CONTENT)

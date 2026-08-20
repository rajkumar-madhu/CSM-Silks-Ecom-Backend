from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.db.models import Q
from django.utils.text import slugify
from rest_framework import serializers
from inventory.models import StockLedger

from .models import AttributeOption, Category, Collection, Product, ProductImage, ProductVariant


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "name", "slug", "gender", "parent_id", "sort_order"]


class CollectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Collection
        fields = ["id", "name", "slug", "description", "is_featured", "sort_order"]


class ProductVariantSerializer(serializers.ModelSerializer):
    available_qty = serializers.IntegerField(read_only=True)
    # Kept as string keys for API compatibility — every existing client (PDP, admin
    # list, mobile) reads variant.fabric. The values now come from the product's
    # controlled attributes, so there is one source of truth, not two.
    fabric = serializers.SerializerMethodField()
    zari_type = serializers.SerializerMethodField()

    def get_fabric(self, obj) -> str:
        return obj.product.fabric.label if obj.product.fabric_id else ""

    def get_zari_type(self, obj) -> str:
        return obj.product.zari.label if obj.product.zari_id else ""

    class Meta:
        model = ProductVariant
        fields = [
            "id",
            "sku",
            "title",
            "color_name",
            "color_hex",
            "size",
            "fabric",
            "zari_type",
            "blouse_included",
            "length_meters",
            "blouse_length_meters",
            "weight_grams",
            "care_instructions",
            "price",
            "mrp",
            "stock_qty",
            "reserved_qty",
            "available_qty",
            "reorder_level",
            "last_sold_at",
            "is_active",
        ]


class ProductImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductImage
        fields = ["id", "variant_id", "image_url", "alt_text", "sort_order", "is_primary"]


class AdminCategoryWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "name", "slug", "gender", "parent", "sort_order", "is_active"]
        read_only_fields = ["id"]


class AdminCollectionWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Collection
        fields = ["id", "name", "slug", "description", "is_featured", "sort_order"]
        read_only_fields = ["id"]


class AdminProductImageWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductImage
        fields = ["id", "product", "variant", "image_url", "alt_text", "sort_order", "is_primary"]
        read_only_fields = ["id"]


class ProductListSerializer(serializers.ModelSerializer):
    cat = serializers.CharField(source="category.name", read_only=True)
    category_slug = serializers.CharField(source="category.slug", read_only=True)
    price = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    mrp = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    colors = serializers.SerializerMethodField()
    colours = serializers.SerializerMethodField()
    images = serializers.SerializerMethodField()
    collections = CollectionSerializer(many=True, read_only=True)
    default_variant_id = serializers.SerializerMethodField()
    variant_id = serializers.SerializerMethodField()
    available_qty = serializers.SerializerMethodField()
    discount_percent = serializers.IntegerField(read_only=True)
    badge = serializers.SerializerMethodField()
    badge_text = serializers.SerializerMethodField()
    bg = serializers.SerializerMethodField()
    emoji = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            "id",
            "slug",
            "name",
            "name_tamil",
            "cat",
            "category_slug",
            "gender",
            "hook",
            "description",
            "tags",
            "occasions",
            "brand",
            "seller_name",
            "price",
            "mrp",
            "deal_label",
            "badge",
            "badge_text",
            "emoji",
            "bg",
            "colors",
            "colours",
            "images",
            "collections",
            "default_variant_id",
            "variant_id",
            "available_qty",
            "is_active",
            "is_featured",
            "is_gi_tagged",
            "assured",
            "cod_available",
            "exchange_available",
            "return_days",
            "delivery_min_days",
            "delivery_max_days",
            "discount_percent",
            "avg_rating",
            "review_count",
            "total_sold",
        ]

    def _default_variant(self, obj: Product):
        variants = list(obj.variants.all())
        return next((variant for variant in variants if variant.is_active), variants[0] if variants else None)

    def get_colors(self, obj: Product) -> list[str]:
        colors = [v.color_hex for v in obj.variants.all() if v.color_hex]
        return colors or ["#C4923A", "#8B1A1A"]

    def get_colours(self, obj: Product) -> list[str]:
        return self.get_colors(obj)

    def get_images(self, obj: Product) -> list[str]:
        images = [image.image_url for image in obj.images.all() if image.image_url]
        return images

    def get_default_variant_id(self, obj: Product) -> int | None:
        variant = self._default_variant(obj)
        return variant.id if variant else None

    def get_variant_id(self, obj: Product) -> int | None:
        return self.get_default_variant_id(obj)

    def get_available_qty(self, obj: Product) -> int:
        return sum(v.available_qty for v in obj.variants.all() if v.is_active)

    def get_badge(self, obj: Product) -> str:
        if obj.is_featured:
            return "pb-hot"
        if obj.gender == Product.Gender.MEN:
            return "pb-men"
        return "pb-new"

    def get_badge_text(self, obj: Product) -> str:
        if obj.is_featured:
            return "Bestseller"
        if obj.gender == Product.Gender.MEN:
            return "Men's"
        return "New"

    def get_bg(self, obj: Product) -> str:
        colors = self.get_colors(obj)
        first = colors[0]
        second = colors[1] if len(colors) > 1 else "#2A1808"
        return f"linear-gradient(145deg,#1A1208,{second},{first})"

    def get_emoji(self, obj: Product) -> str:
        return "CSM"

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["badge-text"] = data.pop("badge_text")
        return data


class ProductDetailSerializer(ProductListSerializer):
    variants = ProductVariantSerializer(many=True, read_only=True)
    image_records = ProductImageSerializer(source="images", many=True, read_only=True)
    reviews = serializers.SerializerMethodField()
    attributes = serializers.SerializerMethodField()

    class Meta(ProductListSerializer.Meta):
        fields = ProductListSerializer.Meta.fields + [
            "hsn_code",
            "meta_title",
            "meta_description",
            "key_highlights",
            "specifications",
            "serviceable_pin_codes",
            "variants",
            "image_records",
            "reviews",
            "attributes",
            "created_at",
            "updated_at",
        ]

    def get_attributes(self, obj) -> list[dict]:
        """Typed spec rows for the PDP. Null attributes are omitted rather than
        rendered as blanks — a table of dashes reads as missing data."""
        rows = [
            {"key": key, "label": label, "value": getattr(obj, key).label}
            for key, label in (
                ("fabric", "Fabric"),
                ("weave", "Weave"),
                ("zari", "Zari"),
                ("border", "Border"),
                ("pallu", "Pallu"),
                ("work", "Work"),
                ("origin", "Origin"),
            )
            if getattr(obj, f"{key}_id")
        ]
        if obj.silk_mark_certified:
            rows.append({"key": "silk_mark", "label": "Authenticity", "value": "Silk Mark certified"})
        variant = obj.default_variant
        if variant:
            if variant.length_meters:
                rows.append({"key": "saree_length", "label": "Saree Length", "value": f"{variant.length_meters} m"})
            if variant.blouse_length_meters:
                rows.append({"key": "blouse_length", "label": "Blouse Length", "value": f"{variant.blouse_length_meters} m"})
            rows.append({
                "key": "blouse_piece", "label": "Blouse Piece",
                "value": "Included" if variant.blouse_included else "Not included",
            })
            if variant.weight_grams:
                rows.append({"key": "weight", "label": "Weight", "value": f"{variant.weight_grams} g"})
            if variant.care_instructions:
                rows.append({"key": "care", "label": "Wash Care", "value": variant.care_instructions})
        return rows

    def get_reviews(self, obj: Product) -> list[dict]:
        reviews = obj.reviews.filter(is_published=True).select_related("user")[:10]
        return [
            {
                "id": review.id,
                "rating": review.rating,
                "title": review.title,
                "body": review.body,
                "customer": review.user.display_name,
                "is_verified_purchase": review.is_verified_purchase,
                "created_at": review.created_at,
            }
            for review in reviews
        ]


def _attribute_option_field(key: str) -> serializers.PrimaryKeyRelatedField:
    # Scoped per-attribute so a fabric id can never be assigned to `zari` (or any other
    # attribute), and a soft-deleted (is_active=False) option is rejected as "does not exist"
    # rather than silently accepted — matches the retirement semantics of the delete view.
    return serializers.PrimaryKeyRelatedField(
        queryset=AttributeOption.objects.filter(key=key, is_active=True),
        required=False,
        allow_null=True,
    )


class AdminProductWriteSerializer(serializers.ModelSerializer):
    fabric = _attribute_option_field(AttributeOption.Key.FABRIC)
    weave = _attribute_option_field(AttributeOption.Key.WEAVE)
    zari = _attribute_option_field(AttributeOption.Key.ZARI)
    border = _attribute_option_field(AttributeOption.Key.BORDER)
    pallu = _attribute_option_field(AttributeOption.Key.PALLU)
    work = _attribute_option_field(AttributeOption.Key.WORK)
    origin = _attribute_option_field(AttributeOption.Key.ORIGIN)

    class Meta:
        model = Product
        fields = [
            "id",
            "name",
            "name_tamil",
            "slug",
            "description",
            "hook",
            "category",
            "collections",
            "gender",
            "tags",
            "occasions",
            "brand",
            "seller_name",
            "hsn_code",
            "base_price",
            "base_mrp",
            "deal_label",
            "key_highlights",
            "specifications",
            "serviceable_pin_codes",
            "delivery_min_days",
            "delivery_max_days",
            "return_days",
            "cod_available",
            "exchange_available",
            "assured",
            "is_active",
            "is_featured",
            "is_gi_tagged",
            "fabric",
            "weave",
            "zari",
            "border",
            "pallu",
            "work",
            "origin",
            "silk_mark_certified",
        ]


class AdminAttributeOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = AttributeOption
        fields = ["id", "key", "value_slug", "label", "sort_order", "is_filterable", "is_active"]
        read_only_fields = ["id"]


def _split_text(value) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [part.strip() for part in str(value or "").split(",") if part.strip()]


def _unique_slug(model, base_value: str, current_id: int | None = None) -> str:
    base_slug = slugify(base_value)[:70] or "item"
    slug = base_slug
    counter = 2
    qs = model.objects.all()
    if current_id:
        qs = qs.exclude(id=current_id)
    while qs.filter(slug=slug).exists():
        suffix = f"-{counter}"
        slug = f"{base_slug[: 70 - len(suffix)]}{suffix}"
        counter += 1
    return slug


def _unique_sku(base_value: str) -> str:
    base_sku = "".join(char for char in base_value.upper() if char.isalnum())[:32] or "CSM-SKU"
    sku = base_sku
    counter = 2
    while ProductVariant.objects.filter(sku=sku).exists():
        suffix = f"-{counter}"
        sku = f"{base_sku[: 60 - len(suffix)]}{suffix}"
        counter += 1
    return sku


class AdminProductQuickCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255)
    slug = serializers.SlugField(required=False, allow_blank=True)
    gender = serializers.ChoiceField(choices=Product.Gender.choices, default=Product.Gender.WOMEN)
    category_name = serializers.CharField(max_length=120)
    category_slug = serializers.SlugField(required=False, allow_blank=True)
    collection_name = serializers.CharField(max_length=120, required=False, allow_blank=True)
    collection_slug = serializers.SlugField(required=False, allow_blank=True)
    collection_description = serializers.CharField(required=False, allow_blank=True)
    hook = serializers.CharField(max_length=255, required=False, allow_blank=True)
    description = serializers.CharField(required=False, allow_blank=True)
    tags = serializers.ListField(child=serializers.CharField(max_length=80), required=False)
    tags_text = serializers.CharField(required=False, allow_blank=True)
    occasions = serializers.ListField(child=serializers.CharField(max_length=80), required=False)
    occasions_text = serializers.CharField(required=False, allow_blank=True)
    price = serializers.DecimalField(max_digits=12, decimal_places=2)
    mrp = serializers.DecimalField(max_digits=12, decimal_places=2)
    cost_price = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True)
    stock_qty = serializers.IntegerField(min_value=0, default=1)
    sku = serializers.CharField(max_length=60, required=False, allow_blank=True)
    color_name = serializers.CharField(max_length=60, required=False, allow_blank=True)
    color_hex = serializers.CharField(max_length=16, required=False, allow_blank=True)
    size = serializers.CharField(max_length=40, required=False, allow_blank=True)
    fabric = serializers.CharField(max_length=100, required=False, allow_blank=True)
    zari_type = serializers.CharField(max_length=80, required=False, allow_blank=True)
    blouse_included = serializers.BooleanField(default=True)
    image_url = serializers.URLField(max_length=600, required=False, allow_blank=True)
    alt_text = serializers.CharField(max_length=160, required=False, allow_blank=True)
    deal_label = serializers.CharField(max_length=120, required=False, allow_blank=True)
    is_featured = serializers.BooleanField(default=False)
    is_active = serializers.BooleanField(default=True)
    assured = serializers.BooleanField(default=True)
    cod_available = serializers.BooleanField(default=True)
    exchange_available = serializers.BooleanField(default=True)
    return_days = serializers.IntegerField(min_value=0, max_value=60, default=15)

    def _resolve_option(self, key: str, value: str):
        value = (value or "").strip()
        if not value:
            return None
        option = AttributeOption.objects.filter(
            key=key, is_active=True
        ).filter(Q(value_slug__iexact=value) | Q(label__iexact=value)).first()
        if option is None:
            # Bare message, not {key: message}: this runs from validate_<field> (DRF keys
            # the error to the field on its own), where a dict would double-nest — and
            # validate_zari_type's field is "zari_type" while the vocabulary key is "zari",
            # so a hardcoded dict key here would mismatch the request field entirely.
            raise serializers.ValidationError(
                f"Unknown {key}. Add it under Admin > Attribute options first, then retry."
            )
        return option

    def validate_fabric(self, value):
        self._resolve_option("fabric", value)
        return value

    def validate_zari_type(self, value):
        self._resolve_option("zari", value)
        return value

    def validate(self, attrs):
        if attrs["mrp"] < attrs["price"]:
            raise serializers.ValidationError({"mrp": "MRP must be greater than or equal to selling price."})
        if attrs.get("slug") and Product.objects.filter(slug=attrs["slug"]).exists():
            raise serializers.ValidationError({"slug": "A product with this slug already exists."})
        if attrs.get("sku") and ProductVariant.objects.filter(sku=attrs["sku"]).exists():
            raise serializers.ValidationError({"sku": "A variant with this SKU already exists."})
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        gender = validated_data["gender"]
        category_slug = validated_data.get("category_slug") or slugify(validated_data["category_name"])
        category, _ = Category.objects.get_or_create(
            slug=category_slug,
            defaults={
                "name": validated_data["category_name"],
                "gender": gender,
                "is_active": True,
            },
        )
        if category.name != validated_data["category_name"] or category.gender != gender or not category.is_active:
            category.name = validated_data["category_name"]
            category.gender = gender
            category.is_active = True
            category.save(update_fields=["name", "gender", "is_active"])

        collection = None
        collection_name = validated_data.get("collection_name", "").strip()
        if collection_name:
            collection_slug = validated_data.get("collection_slug") or slugify(collection_name)
            collection, _ = Collection.objects.get_or_create(
                slug=collection_slug,
                defaults={
                    "name": collection_name,
                    "description": validated_data.get("collection_description", ""),
                    "is_featured": validated_data["is_featured"],
                },
            )
            collection.name = collection_name
            collection.description = validated_data.get("collection_description", collection.description)
            collection.is_featured = collection.is_featured or validated_data["is_featured"]
            collection.save(update_fields=["name", "description", "is_featured"])

        tags = validated_data.get("tags") or _split_text(validated_data.get("tags_text"))
        occasions = validated_data.get("occasions") or _split_text(validated_data.get("occasions_text"))
        fabric_option = self._resolve_option("fabric", validated_data.get("fabric", ""))
        zari_option = self._resolve_option("zari", validated_data.get("zari_type", ""))
        # Canonical label, not the raw input, so derived text (tags, key highlights,
        # specifications) can't reintroduce the free-text drift this feature closes.
        fabric = fabric_option.label if fabric_option else ""
        color_name = validated_data.get("color_name", "").strip()
        if fabric and fabric not in tags:
            tags.append(fabric)
        if color_name and color_name not in tags:
            tags.append(color_name)

        price = validated_data["price"]
        mrp = validated_data["mrp"] or price
        product_slug = validated_data.get("slug") or _unique_slug(Product, validated_data["name"])
        product = Product.objects.create(
            name=validated_data["name"],
            slug=product_slug,
            category=category,
            gender=gender,
            hook=validated_data.get("hook", ""),
            description=validated_data.get("description", ""),
            tags=tags,
            occasions=occasions,
            base_price=price,
            base_mrp=mrp,
            fabric=fabric_option,
            zari=zari_option,
            deal_label=validated_data.get("deal_label", ""),
            key_highlights=[
                item
                for item in [
                    "Pure silk textile",
                    fabric,
                    color_name,
                    "Ready to ship stock",
                ]
                if item
            ],
            specifications={
                "Fabric": fabric or "Pure silk",
                "Color": color_name or "Assorted",
                "Blouse": "Included" if validated_data.get("blouse_included") else "Not included",
                "Seller": "CSM Silks Kanchipuram",
            },
            return_days=validated_data["return_days"],
            cod_available=validated_data["cod_available"],
            exchange_available=validated_data["exchange_available"],
            assured=validated_data["assured"],
            is_active=validated_data["is_active"],
            is_featured=validated_data["is_featured"],
        )
        if collection:
            product.collections.add(collection)

        sku = validated_data.get("sku") or _unique_sku(f"CSM{product.id}{product.slug[:14]}")
        variant = ProductVariant.objects.create(
            product=product,
            sku=sku,
            title=f"{color_name or 'Default'} {validated_data.get('size') or ''}".strip(),
            color_name=color_name,
            color_hex=validated_data.get("color_hex", "") or "#C4923A",
            size=validated_data.get("size", ""),
            blouse_included=validated_data.get("blouse_included", True),
            price=price,
            mrp=mrp,
            cost_price=validated_data.get("cost_price") or Decimal("0.00"),
            stock_qty=validated_data["stock_qty"],
            reorder_level=5,
            is_active=True,
        )
        request = self.context.get("request")
        StockLedger.objects.create(
            variant=variant,
            quantity_delta=validated_data["stock_qty"],
            reason=StockLedger.Reason.ADJUSTMENT,
            reference="admin-quick-create",
            note="Opening stock from admin catalog publish",
            created_by=request.user if request and request.user.is_authenticated else None,
        )

        image_url = validated_data.get("image_url", "").strip()
        if image_url:
            ProductImage.objects.create(
                product=product,
                variant=variant,
                image_url=image_url,
                alt_text=validated_data.get("alt_text") or product.name,
                sort_order=0,
                is_primary=True,
            )
        return product


class AdminVariantWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductVariant
        fields = [
            "id",
            "product",
            "sku",
            "title",
            "color_name",
            "color_hex",
            "size",
            "blouse_included",
            "length_meters",
            "care_instructions",
            "price",
            "mrp",
            "cost_price",
            "stock_qty",
            "reserved_qty",
            "reorder_level",
            "is_active",
        ]
